
export default function bookingConfirmationEmail(data) {
  const escapeHtml = (value = "") =>
    String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);

  const formatPrice = (amount) =>
    `৳${Number(amount || 0).toLocaleString("en-BD")}`;

  const formatDate = (date) =>
    date
      ? new Date(date).toLocaleDateString("en-BD", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "N/A";

  const bookings = (data.bookings || []).map((booking) => `
    <tr>
      <td style="padding:20px 16px;border-bottom:1px solid #1e293b;">
        <div style="font-size:15px;font-weight:600;color:#ffffff;">
          ${escapeHtml(booking.facilityName)}
        </div>

        <div style="margin-top:5px;font-size:13px;color:#94a3b8;">
          ${escapeHtml(booking.serviceName)}
        </div>

        ${booking.movieName ? `
          <div style="margin-top:5px;font-size:12px;color:#64748b;">
            Movie: ${escapeHtml(booking.movieName)}
          </div>
        ` : ""}

        <div style="margin-top:12px;font-size:12px;color:#94a3b8;">
          Date: ${formatDate(booking.bookingDate)}
        </div>

        <div style="margin-top:5px;font-size:12px;color:#94a3b8;">
          Time: ${escapeHtml(booking.startTime)} - ${escapeHtml(booking.endTime)}
        </div>

        <div style="margin-top:5px;font-size:12px;color:#94a3b8;">
          Quantity: ${escapeHtml(booking.quantity)}
        </div>
      </td>

      <td align="right" valign="top"
          style="padding:20px 16px;border-bottom:1px solid #1e293b;
          font-size:14px;font-weight:600;color:#ffffff;white-space:nowrap;">
        ${formatPrice(booking.totalAmount)}
      </td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation - The Checkpoint</title>
</head>

<body style="margin:0;padding:0;background-color:#030712;
font-family:Arial,Helvetica,sans-serif;color:#ffffff;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0"
       border="0" style="background-color:#030712;">
<tr>
<td align="center" style="padding:35px 12px;">

<table role="presentation" width="100%" cellspacing="0" cellpadding="0"
       border="0"
       style="max-width:620px;background-color:#07101D;
       border:1px solid #1e293b;border-radius:16px;overflow:hidden;">

  <!-- Header -->
  <tr>
    <td align="center" style="padding:30px 24px;border-bottom:1px solid #1e293b;">

      <div style="font-size:23px;font-weight:800;letter-spacing:2px;
      color:#ffffff;">
        THE <span style="color:#3b82f6;">CHECKPOINT</span>
      </div>

      <div style="margin-top:7px;font-size:10px;letter-spacing:3px;
      color:#64748b;text-transform:uppercase;">
        Dhaka · Gaming · Entertainment
      </div>

    </td>
  </tr>

  <!-- Success Section -->
  <tr>
    <td align="center" style="padding:38px 24px 30px;">

      <div style="width:66px;height:66px;line-height:66px;
      margin:0 auto 20px;border-radius:50%;
      background-color:#064e3b;color:#34d399;
      font-size:36px;font-weight:bold;">
        &#10003;
      </div>

      <div style="font-size:11px;font-weight:700;
      letter-spacing:2px;color:#34d399;text-transform:uppercase;">
        PAYMENT CONFIRMED
      </div>

      <h1 style="margin:14px 0 12px;font-size:27px;
      line-height:1.3;color:#ffffff;">
        Your booking is confirmed!
      </h1>

      <p style="margin:0 auto;max-width:440px;
      font-size:14px;line-height:1.8;color:#94a3b8;">
        Hi ${escapeHtml(data.customer?.name || "Customer")},
        your payment has been successfully verified and
        your booking is confirmed. We look forward to welcoming you!
      </p>

    </td>
  </tr>

  <!-- Booking Reference -->
  <tr>
    <td style="padding:0 24px 25px;">

      <table role="presentation" width="100%" cellspacing="0"
             cellpadding="0" border="0"
             style="background-color:#0b1728;
             border:1px solid #1e293b;border-radius:10px;">

        <tr>
          <td style="padding:18px 20px;">

            <div style="font-size:10px;font-weight:700;
            letter-spacing:1.5px;color:#64748b;">
              BOOKING REFERENCE
            </div>

            <div style="margin-top:9px;font-size:17px;
            font-weight:700;color:#60a5fa;word-break:break-all;">
              ${escapeHtml(data.bookingGroupReference)}
            </div>

          </td>
        </tr>

      </table>

    </td>
  </tr>

  <!-- Booking Details -->
  <tr>
    <td style="padding:0 24px 10px;">

      <div style="margin-bottom:15px;font-size:11px;
      font-weight:700;letter-spacing:1.5px;color:#94a3b8;">
        BOOKING DETAILS
      </div>

      <table role="presentation" width="100%" cellspacing="0"
             cellpadding="0" border="0"
             style="background-color:#0b1728;
             border:1px solid #1e293b;border-radius:10px;">

        ${bookings}

      </table>

    </td>
  </tr>

  <!-- Total -->
  <tr>
    <td style="padding:15px 24px 25px;">

      <table role="presentation" width="100%" cellspacing="0"
             cellpadding="0" border="0"
             style="border-top:1px solid #1e293b;">

        <tr>
          <td style="padding-top:20px;font-size:14px;color:#94a3b8;">
            Total Amount Paid
          </td>

          <td align="right" style="padding-top:20px;
          font-size:23px;font-weight:800;color:#ffffff;">
            ${formatPrice(data.totalAmount)}
          </td>
        </tr>

      </table>

    </td>
  </tr>

  <!-- Information -->
  <tr>
    <td style="padding:0 24px 30px;">

      <table role="presentation" width="100%" cellspacing="0"
             cellpadding="0" border="0"
             style="background-color:#0b1728;
             border-left:3px solid #3b82f6;">

        <tr>
          <td style="padding:16px 18px;">

            <div style="font-size:13px;font-weight:700;color:#ffffff;">
              Important Information
            </div>

            <p style="margin:8px 0 0;font-size:12px;
            line-height:1.8;color:#94a3b8;">
              Please keep your booking reference handy when visiting
              The Checkpoint. If you have any questions about your
              booking, contact our support team.
            </p>

          </td>
        </tr>

      </table>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td align="center"
        style="padding:25px 20px;background-color:#030712;
        border-top:1px solid #1e293b;">

      <div style="font-size:14px;font-weight:700;color:#ffffff;">
        THE CHECKPOINT DHAKA
      </div>

      <p style="margin:10px 0;font-size:12px;color:#64748b;">
        Bashundhara R/A, Dhaka, Bangladesh
      </p>

      <p style="margin:8px 0;font-size:12px;">
        <a href="https://checkpoint.place"
           style="color:#60a5fa;text-decoration:none;">
          checkpoint.place
        </a>
      </p>

      <p style="margin:8px 0;font-size:12px;color:#64748b;">
        +8801844-240483
      </p>

      <div style="margin-top:20px;font-size:10px;
      color:#475569;line-height:1.6;">
        This is an automated booking confirmation email.
        Please do not reply directly to this email.
      </div>

    </td>
  </tr>

</table>

</td>
</tr>
</table>

</body>
</html>
  `;
}
