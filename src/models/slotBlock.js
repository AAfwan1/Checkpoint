// This stores manual blocks separately from bookings and booking locks
import mongoose from "mongoose";

const SlotBlockSchema = new mongoose.Schema(
  {
    facilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Facility",
      required: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    bookingDate: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    resourceKey: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      default: "",
      maxlength: 200,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
  },
  { timestamps: true }
);

SlotBlockSchema.index({
  facilityId: 1,
  bookingDate: 1,
  startTime: 1,
  endTime: 1,
});

export default mongoose.models.SlotBlock ||
  mongoose.model("SlotBlock", SlotBlockSchema);
