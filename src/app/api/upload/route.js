import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { ACCEPTED_UPLOAD_TYPES } from "@/constants/requisitionOptions";
import { connectDB } from "@/lib/db";
import Requisition from "@/models/Requisition";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

// Expects JSON body: { requisitionId, fileName, fileType, fileBase64 }.
// The request is validated and ownership checked before Cloudinary is called.
export async function POST(request) {
  const auth = getAuth();
  if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { requisitionId, fileName, fileType, fileBase64 } = body || {};

    if (!mongoose.isValidObjectId(requisitionId)) {
      return NextResponse.json({ message: "A valid requisition ID is required." }, { status: 400 });
    }

    if (!ACCEPTED_UPLOAD_TYPES.includes(fileType)) {
      return NextResponse.json(
        { message: "Unsupported file type. Only PDF, image, and Word documents are allowed." },
        { status: 400 }
      );
    }

    if (typeof fileBase64 !== "string" || !fileBase64.startsWith(`data:${fileType};base64,`)) {
      return NextResponse.json({ message: "The file data does not match the selected file type." }, { status: 400 });
    }

    const base64Payload = fileBase64.slice(fileBase64.indexOf(",") + 1);
    if (!base64Payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Payload)) {
      return NextResponse.json({ message: "The uploaded file data is malformed." }, { status: 400 });
    }
    const fileBytes = Buffer.from(base64Payload, "base64");
    if (fileBytes.length <= 0 || fileBytes.length > MAX_FILE_BYTES) {
      return NextResponse.json({ message: "Files must be between 1 byte and 10 MB." }, { status: 413 });
    }

    // Verify the file signature instead of trusting the client-supplied MIME type.
    const signatureChecks = {
      "application/pdf": () => fileBytes.subarray(0, 5).toString("ascii") === "%PDF-",
      "image/png": () => fileBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/jpeg": () => fileBytes.length >= 3 && fileBytes[0] === 0xff && fileBytes[1] === 0xd8 && fileBytes[2] === 0xff,
      "image/jpg": () => fileBytes.length >= 3 && fileBytes[0] === 0xff && fileBytes[1] === 0xd8 && fileBytes[2] === 0xff,
      "application/msword": () => fileBytes.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": () => fileBytes.subarray(0, 2).toString("ascii") === "PK",
    };
    if (!signatureChecks[fileType]?.()) {
      return NextResponse.json({ message: "The file contents do not match the selected file type." }, { status: 400 });
    }

    if (typeof fileName !== "string" || !fileName.trim() || fileName.length > 180) {
      return NextResponse.json({ message: "A valid file name (maximum 180 characters) is required." }, { status: 400 });
    }

    await connectDB();

    // Only the original requester can attach files through this endpoint.
    // Check this before the external upload to prevent unauthorized Cloudinary usage.
    const requisition = await Requisition.findOne({
      _id: requisitionId,
      requester: auth.sub,
    }).select("_id attachments");

    if (!requisition) {
      return NextResponse.json({ message: "Requisition not found or you are not its requester." }, { status: 404 });
    }

    const safeFileName = fileName.trim().replace(/[\\/\0-\x1f\x7f]/g, "_").slice(0, 180);
    const { url, publicId } = await uploadToCloudinary(
      fileBase64,
      `ksu-procurement/requisitions/${requisitionId}`
    );

    requisition.attachments = Array.isArray(requisition.attachments) ? requisition.attachments : [];
    requisition.attachments.push({ url, publicId, fileName: safeFileName, fileType });
    await requisition.save();

    return NextResponse.json({ requisition });
  } catch (err) {
    console.error("Requisition attachment upload failed:", err);
    return NextResponse.json({ message: "Upload failed." }, { status: 500 });
  }
}
