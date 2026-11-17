import os

# ------------------ OFFLINE EMBEDDING MODEL ------------------
# The embedding model is kept inside the project (models/all-MiniLM-L6-v2), so it
# loads from disk with no internet. Offline mode must be switched on BEFORE
# sentence_transformers / huggingface_hub are imported, otherwise they try to
# contact huggingface.co first (about 50 s of retries when there is no internet).
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
LOCAL_MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", EMBED_MODEL_NAME)
_HAS_LOCAL_MODEL = os.path.isfile(os.path.join(LOCAL_MODEL_DIR, "config.json"))
if _HAS_LOCAL_MODEL:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

import re
import fitz
import pytesseract
from docx import Document
from PIL import Image
from sentence_transformers import SentenceTransformer
import numpy as np
import pickle
import faiss

pytesseract.pytesseract.tesseract_cmd = r"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"


def _load_embed_model():
    if _HAS_LOCAL_MODEL:
        return SentenceTransformer(LOCAL_MODEL_DIR, device="cpu")
    # First run only: take the model from the Hugging Face cache on this computer
    # (or download it once if it is not there), then keep a copy in models/
    model = SentenceTransformer(EMBED_MODEL_NAME, device="cpu")
    model.save(LOCAL_MODEL_DIR)
    print(f"Saved the embedding model to {LOCAL_MODEL_DIR} for offline use.")
    return model


EMBED_MODEL = _load_embed_model()


# ------------------ PARSE ------------------
def parse_document(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    chunks = []

    if ext == ".pdf":
        doc = fitz.open(file_path)
        for i, page in enumerate(doc):
            text = page.get_text("text")
            if text.strip():
                chunks.append({"content": text, "page": i+1, "source": file_path})

    elif ext in [".docx", ".doc"]:
        doc = Document(file_path)
        for i, para in enumerate(doc.paragraphs):
            if para.text.strip():
                chunks.append({"content": para.text, "page": i+1, "source": file_path})

    elif ext in [".png", ".jpg", ".jpeg"]:
        img = Image.open(file_path)
        text = pytesseract.image_to_string(img)
        chunks.append({"content": text, "page": 1, "source": file_path})

    else:
        raise ValueError("Unsupported file type")

    return chunks


# ------------------ CHUNK ------------------
def chunk_text(text, chunk_size=500, overlap=100):
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap

    return chunks


# ------------------ PROCESS ------------------
def process_document(file_path):
    base_name = os.path.splitext(os.path.basename(file_path))[0]

    os.makedirs("storage", exist_ok=True)

    embed_path = f"storage/{base_name}_embeddings.npy"
    chunk_path = f"storage/{base_name}_chunks.pkl"
    faiss_path = f"storage/{base_name}.index"

   
    if os.path.exists(embed_path) and os.path.exists(faiss_path):
        embeddings = np.load(embed_path)
        index = faiss.read_index(faiss_path)

        with open(chunk_path, "rb") as f:
            final_chunks = pickle.load(f)

        return final_chunks, embeddings, index

    documents = parse_document(file_path)
    final_chunks = []

    for doc in documents:
        small_chunks = chunk_text(doc["content"])
        for chunk in small_chunks:
            final_chunks.append({
                "content": chunk,
                "page": doc["page"],
                "source": doc["source"]
            })

    texts = [c["content"] for c in final_chunks]


    embeddings = EMBED_MODEL.encode(texts, batch_size=32, normalize_embeddings=True)

    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(np.array(embeddings))

    np.save(embed_path, embeddings)
    faiss.write_index(index, faiss_path)

    with open(chunk_path, "wb") as f:
        pickle.dump(final_chunks, f)

    return final_chunks, embeddings, index


# ------------------ LOAD FROM CACHE ------------------
def load_cached_document(base_name):
    """Load a previously processed document from storage/. Returns (chunks, index) or None."""
    chunk_path = f"storage/{base_name}_chunks.pkl"
    faiss_path = f"storage/{base_name}.index"
    if not (os.path.exists(chunk_path) and os.path.exists(faiss_path)):
        return None
    index = faiss.read_index(faiss_path)
    with open(chunk_path, "rb") as f:
        chunks = pickle.load(f)
    return chunks, index


# ------------------ RETRIEVE ------------------
# Minimum cosine similarity for a chunk to count as related to the question.
# Measured on our documents: on-topic questions score 0.45-0.77,
# unrelated ones (sports, cooking, greetings) score 0.18 or less.
MIN_RELEVANCE = 0.30


def retrieve_context(query, index, chunks, top_k=3):
    """Return (context, retrieved_chunks, best_score). best_score is the cosine
    similarity (-1..1) of the closest chunk; low means the document does not
    talk about the question."""
    query_embedding = EMBED_MODEL.encode([query], normalize_embeddings=True)

    k = min(top_k, len(chunks))
    D, I = index.search(np.array(query_embedding), k)

    retrieved = [chunks[i] for i in I[0] if i >= 0]

    # Vectors are normalized, so L2 distance d relates to cosine as cos = 1 - d/2
    best_score = float(1 - D[0][0] / 2) if len(D[0]) else -1.0

    context = "\n\n".join([c["content"] for c in retrieved])
    context = context[:1500]

    return context, retrieved, best_score


# Requests about the document as a whole ("summarize this") don't match any
# single passage, so they get chunks spread evenly across the document instead.
OVERVIEW_WORDS = (
    "summarize", "summarise", "summary", "overview", "key points", "main points",
    "main topics", "key topics", "what is this document", "what is this file",
    "what is this image", "what is in this", "what does this", "what's in this",
    "about this document", "about this file", "about this image", "explain this document",
    "explain this image", "describe this", "read this",
)


# "tell me about the pdf", "what is in this file", "what is the paper about"
_ABOUT_DOC = re.compile(
    r"\b(about|in|inside|of)\s+(the|this|my|that|uploaded)\s+(pdf|document|doc|file|paper|image|picture|photo|notes)\b"
    r"|\b(the|this|my)\s+(pdf|document|file|paper|image|picture|notes)\s+(is\s+)?about\b",
    re.IGNORECASE,
)


def is_overview_request(query):
    q = query.lower()
    return any(w in q for w in OVERVIEW_WORDS) or bool(_ABOUT_DOC.search(query))


# Questions that point at the uploaded file itself ("tell me about the pdf",
# "explain one of the questions in this paper", "what is on page 3") are always
# about the document, even when they share few words with any passage.
_DOC_REFERENCE = re.compile(
    r"\b(pdf|docx?|document|file|paper|notes|image|picture|photo|scan|screenshot|"
    r"upload(ed)?|attachment|page\s*\d+|question\s*(no\.?\s*)?\d+|questions?|q\s*\d+|"
    r"chapter|section|passage|unit)\b",
    re.IGNORECASE,
)


def refers_to_document(query):
    return bool(_DOC_REFERENCE.search(query))


def document_question_context(query, index, chunks, max_chars=3000):
    """For questions about the document itself: the best-matching passages first,
    then passages spread across the whole document."""
    _, best, _ = retrieve_context(query, index, chunks)
    _, spread = overview_context(chunks, max_chunks=6, max_chars=10**9)
    picked, seen = [], set()
    for c in best + spread:
        key = id(c)
        if key not in seen:
            seen.add(key)
            picked.append(c)
    context = "\n\n".join(c["content"] for c in picked)[:max_chars]
    return context, picked


def overview_context(chunks, max_chunks=6, max_chars=3000):
    """Pick chunks evenly spaced through the document."""
    if len(chunks) <= max_chunks:
        picked = chunks
    else:
        step = len(chunks) / max_chunks
        picked = [chunks[int(i * step)] for i in range(max_chunks)]
    context = "\n\n".join(c["content"] for c in picked)[:max_chars]
    return context, picked