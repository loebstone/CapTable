import { randomUUID } from "node:crypto";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
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
    // Clean staging bytes only, never attached documents or append-only records.
    try {
      const [metadata] = await source.getMetadata();
      const actual = BigInt(metadata.size ?? "0");
      if (actual < 1n || actual > 20971520n) throw new HttpError(400, "Uploaded source document must be between 1 byte and 20 MiB");
      if (actual !== BigInt(size)) throw new HttpError(400, "Uploaded file size does not match the reserved source document");
      // Pin validation AND copying to one immutable object generation to avoid a PUT race.
      const generation = metadata.generation;
      if (!generation) throw new HttpError(502, "Upload generation could not be verified");
      const pinned = source.bucket.file(source.name, { generation });
      const [header] = await pinned.download({ start: 0, end: 15 });
      if (!contentMatches(header, contentType)) throw new HttpError(400, "Uploaded file contents do not match an allowed PDF or image type");
      const destinationPath = `/objects/year-documents/${randomUUID()}`;
      const privatePrefix = storage.getPrivateObjectDir().split("/").filter(Boolean).slice(1).join("/");
      const destination = source.bucket.file(`${privatePrefix}/year-documents/${destinationPath.split("/").pop()}`);
      await pinned.copy(destination, { preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType } });
      return destinationPath;
    } finally {
      // No scheduled cleanup. Abandoned or later recreated staging uploads may remain.
      await source.delete({ ignoreNotFound: true });
    }
  },
  async getFile(objectPath: string) {
    return storage.getObjectEntityFile(objectPath);
  },
  // The caller must have checked the persisted is_practice flag under the write lock.
  async removePracticeFiles(paths: string[]) {
    let removed = 0;
    for (const path of new Set(paths)) {
      if (!/^\/objects\/(uploads|year-documents)\/[a-f0-9-]+$/.test(path)) throw new HttpError(409, "Practice document has an invalid private object path");
    }
    for (const path of new Set(paths)) {
      try {
        const file = await storage.getObjectEntityFile(path);
        await file.delete({ ignoreNotFound: true });
        removed++;
      } catch (error) {
        if (!(error instanceof ObjectNotFoundError)) throw new HttpError(502, "Practice file cleanup did not complete. No database records were removed. Retry reset to finish cleanup.");
      }
    }
    return removed;
  },
};
