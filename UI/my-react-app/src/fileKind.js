// "image" for PNG/JPG uploads, "document" for PDF/Word files
export const isImageFile = (name) => /\.(png|jpe?g)$/i.test(name || "");
export const fileKind = (name) => (isImageFile(name) ? "image" : "document");
