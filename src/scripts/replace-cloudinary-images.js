
const fs = require("node:fs");
const path = require("node:path");
const cloudinary = require("cloudinary").v2;

const ROOT = path.resolve(__dirname, "../..");
const envPath = path.join(ROOT, ".env.local");

// Load .env.local.
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?$/);

    if (!match || process.env[match[1]] !== undefined) continue;

    let value = (match[2] || "").trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[match[1]] = value;
  }
}

cloudinary.config({
  cloud_name: "qds5td8c",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  ...(process.env.CLOUDINARY_URL
    ? { cloudinary_url: process.env.CLOUDINARY_URL }
    : {}),
});

const images = [
  {
    file: path.join(ROOT, "public", "packeges.webp"),
    public_id: "the-checkpoint/packeges",
  },
  {
    file: path.join(ROOT, "public", "pricelist.webp"),
    public_id: "the-checkpoint/gaming/pricelist",
  },
];

async function main() {
  if (
    !process.env.CLOUDINARY_URL &&
    (!process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error(
      "Missing Cloudinary credentials in Checkpoint/.env.local."
    );
  }

  for (const image of images) {
    if (!fs.existsSync(image.file)) {
      throw new Error(`Image not found: ${image.file}`);
    }

    console.log(`Uploading ${path.basename(image.file)}...`);

    const result = await cloudinary.uploader.upload(image.file, {
      public_id: image.public_id,
      overwrite: true,
      invalidate: true,
      resource_type: "image",
      unique_filename: false,
    });

    console.log(`Public ID: ${result.public_id}`);
    console.log(`New URL: ${result.secure_url}`);
  }

  console.log("Both uploads completed successfully.");
}

main().catch((error) => {
  console.error("Upload failed:", error.message);
  process.exitCode = 1;
});
