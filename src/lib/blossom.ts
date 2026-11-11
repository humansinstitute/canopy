import { createUploadAuth, uploadBlob, type BlobDescriptor } from "nostr-tools/nipb7";
import { getAccountProvider } from "./session";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function validateImageUpload(file: File): void {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} must be smaller than 10 MB.`);
}

export async function uploadImage(file: File, servers: string[]): Promise<BlobDescriptor> {
  validateImageUpload(file);
  if (!servers.length) throw new Error("Add a Blossom upload server in Settings first.");
  const signer = getAccountProvider();
  if (!signer) throw new Error("Your Nostr signer is unavailable.");
  const failures: string[] = [];
  for (const server of servers) {
    try {
      const descriptor = await uploadBlob(server, file, {
        auth: true,
        timeout: 20_000,
        onAuth: async (target, sha256) => createUploadAuth(
          (template) => signer.signEvent(template),
          sha256,
          { servers: target, message: "Upload image from Canopy", expiration: Math.floor(Date.now() / 1000) + 300 },
        ),
      });
      const uploadedUrl = new URL(descriptor.url);
      if (uploadedUrl.protocol !== "https:") throw new Error("Blossom returned an insecure image URL.");
      return descriptor;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `Upload failed on ${server}`);
    }
  }
  throw new Error(failures.at(-1) || "No Blossom server accepted the image.");
}
