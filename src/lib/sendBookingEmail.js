
import  bookingConfirmationEmail from "./emailtemplates/bookingConfirmation.js"

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
            email: booking.email,
            name: booking.guestName,
          },
        ],
        subject: "Booking Confirmation - Thakben",
        htmlContent: bookingConfirmationEmail(booking),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Brevo error: ${error}`);
  }

  return response.json();
}
