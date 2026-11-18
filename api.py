from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import hashlib
import os
import threading
import ollama
import json

import ollama_service
from ollama_service import MODEL, KEEP_ALIVE, OLLAMA_URL

# Talks only to Ollama on this computer (no proxy, no internet)
llm = ollama.Client(host=OLLAMA_URL, trust_env=False)

from app import (process_document, retrieve_context, load_cached_document,
                 is_overview_request, overview_context, MIN_RELEVANCE,
                 refers_to_document, document_question_context)


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Documents kept in memory, keyed by doc_id: {"chunks": [...], "index": faiss index}
# Each chat session in the UI remembers its own doc_id and sends it with every question.
# Indexes are saved in storage/, so a document can be reloaded after a restart.
DOCS = {}


def get_document(doc_id):
    """Return (chunks, index) for a doc_id, loading it from storage/ if needed."""
    if doc_id in DOCS:
        return DOCS[doc_id]["chunks"], DOCS[doc_id]["index"]
    loaded = load_cached_document(doc_id)
    if loaded:
        chunks, index = loaded
        DOCS[doc_id] = {"chunks": chunks, "index": index}
        return chunks, index
    return None


# ------------------ STARTUP: start the AI model automatically ------------------
@app.on_event("startup")
def start_llm_in_background():
    # Runs in a thread so the backend is usable (uploads work) while llama3 loads
    threading.Thread(target=ollama_service.ensure_ollama, daemon=True).start()


# ------------------ HEALTH ------------------
@app.get("/health")
def health():
    # llm: "starting" | "loading" | "ready" | "model_missing" | "not_installed" | "error"
    return {"status": "ok", "llm": ollama_service.status["llm"], "llm_detail": ollama_service.status["detail"]}


# ------------------ UPLOAD ------------------
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    original_name = os.path.basename(file.filename)
    ext = os.path.splitext(original_name)[1].lower()
    content = await file.read()

    # doc_id = fingerprint of the file's content: the same file always gets the
    # same id, so uploading it again reuses the saved index in storage/
    doc_id = "doc_" + hashlib.sha256(content).hexdigest()[:16]
    file_path = f"{doc_id}{ext}"

    try:
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        chunks, embeddings, index = process_document(file_path)
    except Exception as e:
        return {"error": str(e)}
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    if not chunks:
        return {"error": "No readable text was found in this file."}

    DOCS[doc_id] = {"chunks": chunks, "index": index}

    return {
        "message": "File processed successfully",
        "doc_id": doc_id,
        "name": original_name,
        "chunks": len(chunks),
    }


# ------------------ CHAT ------------------
@app.post("/chat")
async def chat(query: dict):
    try:
        user_query = query["query"]
        history = query.get("history", "")
        doc_id = query.get("doc_id")
        doc_name = query.get("doc_name") or "document"
        # Say "image" for PNG/JPG uploads and "document" for PDF/Word
        kind = "image" if doc_name.lower().endswith((".png", ".jpg", ".jpeg")) else "document"
        not_found = f"I couldn't find this in the uploaded {kind}."

        def reply(message):
            """Send a fixed message without asking the model."""
            def gen():
                yield f"data: {json.dumps({'token': message})}\n\n"
                yield f"data: {json.dumps({'sources': [], 'done': True})}\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")

        # This chatbot only answers from an uploaded document or image
        if not doc_id:
            return reply("Please upload a PDF, Word file or image first. "
                         "I answer questions only from the document you upload.")

        document = get_document(doc_id)
        if document is None:
            # The session refers to a document whose saved index was deleted
            return reply(f"The {kind} '{doc_name}' is no longer available on the server. "
                         "Please upload it again in this chat.")

        chunks, index = document

        # Extra instruction for questions about the document as a whole
        task_note = ""
        if is_overview_request(user_query):
            # "Summarize this document", "tell me about the pdf": passages from across the file
            context, retrieved = overview_context(chunks)
            task_note = (
                f'The user is asking about the uploaded document as a whole. Words like "the pdf", '
                f'"this document", "the file", "the paper" or "the image" mean {doc_name}, and the '
                "context below is taken from it. Describe what kind of document it is and what it "
                "contains (its main topics, sections or types of questions), using only the context."
            )
        elif refers_to_document(user_query):
            # "Explain one of the questions in this paper", "what is on page 3":
            # always about the document, so never rejected as off-topic
            context, retrieved = document_question_context(user_query, index, chunks)
            task_note = (
                f'Words like "the pdf", "this document", "the file", "the paper" or "the image" mean '
                f"{doc_name}, and the context below is taken from it. Find the part of the context the "
                "user is asking about and answer from it."
            )
        else:
            context, retrieved, best_score = retrieve_context(user_query, index, chunks)
            if best_score < MIN_RELEVANCE:
                # Nothing in the document is related to the question
                return reply(f"{not_found} **{doc_name}** doesn't seem to cover this topic. "
                             f"Try asking about something the {kind} talks about.")

        # Show the original file name in the sources, not the internal id
        retrieved = [{"page": c["page"], "source": doc_name} for c in retrieved]

        prompt = f"""
You are an assistant that answers questions ONLY from the document provided below.

Strict rules:
- Use ONLY the information in "Context from document". Do NOT use any outside or general knowledge.
- If the context does not contain the answer, reply exactly: "{not_found}"
- Do not guess, and do not add facts that are not in the context.
- No greetings or conversational text. Do not ask follow-up questions.
- Do not start with "Here is the answer" or repeat the question; begin directly with the content.
{task_note}

Format:
- Answer directly, using bullet points or a numbered list
- Simple question: 3 to 8 short points
- Complex question: short headings with bullet points
- Avoid long paragraphs

Conversation History:
{history}

Context from document ({doc_name}):
{context}

Question:
{user_query}

Answer:
"""

        def stream_response():
            # If Ollama was closed since startup, start it again (still offline)
            if not ollama_service.is_running():
                ollama_service.ensure_ollama()
            try:
                for chunk in llm.chat(
                    model=MODEL,
                    messages=[{"role": "user", "content": prompt}],
                    stream=True,
                    keep_alive=KEEP_ALIVE,  # keep the model in memory between questions
                ):
                    token = chunk["message"]["content"]
                    yield f"data: {json.dumps({'token': token})}\n\n"
            except Exception as e:
                detail = ollama_service.status["detail"] or str(e)
                msg = f"\n\n[Error: the local AI model could not answer. {detail}]"
                yield f"data: {json.dumps({'token': msg})}\n\n"

            # Send sources at the end
            yield f"data: {json.dumps({'sources': retrieved, 'done': True})}\n\n"

        return StreamingResponse(stream_response(), media_type="text/event-stream")

    except Exception as e:
        return {"error": str(e)}
