
import bookingConfirmationEmail from "./emailtemplates/bookingConfirmation.js";

export async function sendBookingEmail(booking) {
  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME,
          email: process.env.BREVO_SENDER_EMAIL,
        },
        to: [
          {
            email: booking.to,
            name: booking.customerName,
          },
        ],
        subject: `Booking Confirmation - ${booking.bookingGroupReference}`,
        htmlContent: bookingConfirmationEmail({
          customer: { name: booking.customerName },
          bookingGroupReference: booking.bookingGroupReference,
          bookings: booking.bookings,
          totalAmount: booking.totalAmount,
        }),
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Brevo error: ${await response.text()}`);
  }

  return response.json();
}
