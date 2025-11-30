const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();
const bodyParser = require('body-parser')

const MERCHANT_PASS_PHRASE = "$2y$10$Ta0481EDF"

app.use(bodyParser.urlencoded({ extended: true })); // APS sends POST as form
app.use(bodyParser.json());

app.use(express.json());

// ⭐ Correct CORS configuration
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174", "https://my-payfort-api.onrender.com"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ⭐ Handle OPTIONS preflight
app.options("*", cors());

// ---------- SIGNATURE HELPERS ----------
function createSignature(params, requestPhrase) {
  const sorted = Object.keys(params).sort();
  const concatenated = sorted.map((key) => `${key}=${params[key]}`).join("");
  const toHash = `${requestPhrase}${concatenated}${requestPhrase}`;
  return crypto.createHash("sha256").update(toHash).digest("hex");
}

// Helper to verify signature
function verifySignature(params, responsePhrase) {
  const { signature, ...data } = params;

  const sortedKeys = Object.keys(data).sort();
  let baseString = responsePhrase;
  sortedKeys.forEach(key => {
    if (data[key] !== null && data[key] !== "") {
      baseString += `${key}=${data[key]}`;
    }
  });
  baseString += responsePhrase;

  const hash = crypto.createHash('sha256').update(baseString).digest('hex');
  return hash === signature;
}


function encryptOrderDetails(text, secretKey) {
  const toHash = `${secretKey}${text}${secretKey}`;
  return crypto.createHash("sha256").update(toHash).digest("hex");
}

function generateMerchantReference(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TXN-${result}`;
}

// ---------- MAIN PAYFORT ENDPOINT ----------
app.post("/createFormPayLoad", async (req, res) => {
  try {
    const orderID = generateMerchantReference(12);
    const RqPhrase = "$2y$10$Ta0481EDF";

    // Build Payfort payload
    let formPayLoad = {
      command: "PURCHASE",
      language: "en",
      merchant_identifier: "4ada67b5",
      access_code: "M4sQwfE5v1O5QkjocgPW",
      merchant_reference: orderID,
      amount: req.body.amount * 100, // smallest currency
      currency: req.body.currency,
      customer_email: req.body.email,

      // ⚠ Backend callback instead of frontend
      return_url: "https://my-payfort-backend.onrender.com/payfort-callback",
      // return_method: "POST", // important
    };

    // Generate signature for Payfort request
    formPayLoad.signature = createSignature(formPayLoad, RqPhrase);

    // Send response to frontend
    res.json(formPayLoad);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creating Payfort payload" });
  }
});

// Payfort callback endpoint
// app.post("/payfort-callback", (req, res) => {
//   const data = req.body;
//   const RqPhrase = "$2y$10$Ta0481EDF";

//   // Verify signature
//   if (!verifySignature(data, RqPhrase)) {
//     console.log("Invalid signature:", data);
//     return res.status(400).send("Invalid signature");
//   }

//   // Map APS status
//   const isSuccess = data.status === "14"; // APS success code

//   // Redirect to frontend with short safe query params
//   const redirectUrl = `http://localhost:5173/checkout-result?status=${
//     isSuccess ? "success" : "failed"
//   }&amount=${data.amount}&fort_id=${data.fort_id}&merchant_reference=${data.merchant_reference}&response_message=${encodeURIComponent(data.response_message || "")}`;

//   res.redirect(302, redirectUrl);
// });

app.all("/payfort-callback", (req, res, next) => {
  console.log("========== PAYFORT CALLBACK RECEIVED ==========");
  console.log("Method:", req.method);
  console.log("Query params:", req.query);
  console.log("Body:", req.body);
  console.log("===============================================");
  next();
});

function handlePayfortCallback(req, res) {
  try {
    const responsePhrase = "$2y$10$aotEpWOtP";

    console.log("=== Payfort callback received ===");

    // Payfort now sends RAW fields (no `data`)
    const payload = req.method === "GET" ? req.query : req.body;

    console.log("Callback Payload:", payload);

    // --- Extract signature ---
    const responseSignature = payload.signature;
    if (!responseSignature) {
      return res.status(400).send("Missing signature");
    }

    // --- Prepare fields for signature validation ---
    const copied = { ...payload };
    delete copied.signature;

    // Validate signature exactly like Payfort specs
    const calculatedSignature = createSignature(copied, responsePhrase);

    if (calculatedSignature !== responseSignature) {
      return res.status(400).send("Invalid signature");
    }

    // --- Success flag ---
    const isSuccess = payload.status === "14";

    // --- Redirect user to frontend result page ---
    const redirectUrl = `http://localhost:5173/checkout-result?status=${
      isSuccess ? "success" : "failed"
    }&amount=${payload.amount}&fort_id=${
      payload.fort_id
    }&merchant_reference=${
      payload.merchant_reference
    }&response_message=${encodeURIComponent(
      payload.response_message || ""
    )}`;

    return res.redirect(302, redirectUrl);

  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("Callback error");
  }
}

app.get("/payfort-callback", handlePayfortCallback);
app.post("/payfort-callback", handlePayfortCallback);


//here to verify the payment process
app.post("/payment/verify", (req, res) => {
  const encodedData = req.body.data;
  const decoded = JSON.parse(Buffer.from(encodedData, "base64").toString("utf8"));

  const expectedSignature = createSignature(decoded, MERCHANT_PASS_PHRASE);


  if (decoded.signature !== expectedSignature) {
    return res.json({ status: "failed" });
  }

  if (decoded.status === "14") {
    return res.json({ status: "success" });
  }

  return res.json({ status: "failed" });
});




// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
