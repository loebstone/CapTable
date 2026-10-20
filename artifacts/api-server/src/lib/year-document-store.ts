import { randomUUID } from "node:crypto";
import { ObjectStorageService } from "./objectStorage";
import { HttpError } from "./errors";

const storage = new ObjectStorageService();
function contentMatches(bytes: Buffer, contentType: string) {
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (contentType === "image/gif") return ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString());
  if (contentType === "image/webp") return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  return false;
}

// Only this service accesses bytes. No local filesystem or invented-file fallback.
export const yearDocumentStore = {
  async requestUpload() {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    if (!/^\/objects\/uploads\/[a-f0-9-]+$/.test(objectPath)) throw new HttpError(503, "Private document upload storage is not configured correctly");
    return { uploadURL, objectPath };
  },
  async seal(objectPath: string, contentType: string, size: number) {
    const source = await storage.getObjectEntityFile(objectPath);
    const destinationPath = `/objects/year-documents/${randomUUID()}`;
    // The sealed destination NEVER has a signed PUT URL. Reusing a staging URL
    // cannot overwrite a document already attached to a year.
    const privatePrefix = storage.getPrivateObjectDir().split("/").filter(Boolean).slice(1).join("/");
    const destination = source.bucket.file(`${privatePrefix}/year-documents/${destinationPath.split("/").pop()}`);
    await source.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType } });
    const [metadata] = await destination.getMetadata();
    if (String(metadata.size) !== String(size)) throw new HttpError(400, "Uploaded file size does not match the reserved source document");
    const [header] = await destination.download({ start: 0, end: 15 });
    if (!contentMatches(header, contentType)) throw new HttpError(400, "Uploaded file contents do not match an allowed PDF or image type");
    return destinationPath;
  },
  async getFile(objectPath: string) {
    return storage.getObjectEntityFile(objectPath);
  },
};
