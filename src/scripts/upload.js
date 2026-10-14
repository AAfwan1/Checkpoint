
const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

dotenv.config({
  path: path.resolve(__dirname, "../../.env.local"),
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const publicDir = path.resolve(__dirname, "../../public");

const images = [
  "newothergames.jpg",
  "newps5.jpg",
];

// Exact public IDs of the incorrectly uploaded images.
const oldPublicIds = [
  "roqpvjfvjnya1swlkfo1",
  "kmom4eijtcdacbpbjmi9",
];

async function uploadImages() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    console.error("Missing Cloudinary credentials in .env.local");
    process.exitCode = 1;
    return;
  }

  // Remove only the two incorrectly uploaded images.
  try {
    const deletion = await cloudinary.api.delete_resources(
      oldPublicIds,
      { resource_type: "image" }
    );

    console.log("Previous uploads removed:", deletion.deleted);
  } catch (error) {
    console.error("Could not remove previous uploads:", error.message);
    console.error("Stopping to avoid leaving duplicate assets.");
    process.exitCode = 1;
    return;
  }

  // Upload the replacement WebP images.
  for (const filename of images) {
    const filePath = path.join(publicDir, filename);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      console.error(`NOT FOUND: ${filePath}`);
      continue;
    }

    const publicId = path.parse(filename).name;

    try {
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: "image",
        folder: "the-checkpoint/gaming",
        public_id: publicId,
        format: "webp",
        overwrite: true,
        invalidate: true,
      });

      console.log(`\nUploaded: ${filename}`);
      console.log(`URL: ${result.secure_url}`);
    } catch (error) {
      console.error(`FAILED: ${filename}`);
      console.error(error.message);
    }
  }
}

uploadImages();
