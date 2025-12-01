const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const app = express();
const bodyParser = require('body-parser')
const nodemailer = require("nodemailer");
const sql = require("mssql");
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

const sqlConfig = {
  server: "41.128.168.249",
  database: "feeswebtmp",
  user: "sa",
  password: "Finance@2025",
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  requestTimeout: 15000,
};

//Configure NODEMAILER
// const transporter = nodemailer.createTransport({
//   service: "gmail",
//   auth: {
//     user: 'fees@alsson.com',
//     pass: 'gwwowluzlabnfyqw',
//   },
// });

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

async function logPaymentAction(payload) {
  try {
    const pool = await sql.connect(sqlConfig);

    await pool.request()
      .input("fort_id", sql.VarChar, payload.fort_id)
      .input("merchant_reference", sql.VarChar, payload.merchant_reference)
      .input("amount", sql.Int, payload.amount)
      .input("customer_email", sql.VarChar, payload.customer_email)
      .input("payment_option", sql.VarChar, payload.payment_option)
      .input("response_message", sql.VarChar, payload.response_message)
      .input("actiondate", sql.Date, new Date().toLocaleString())
      //{new Date().toLocaleString()}
      .query(`
        INSERT INTO OnlinePayfortLog (
          fort_id,
          merchant_reference,
          amount,
          customer_email,
          payment_option,
          response_message,
          actiondate
        ) VALUES (
          @fort_id,
          @merchant_reference,
          @amount,
          @customer_email,
          @payment_option,
          @response_message,
          @actiondate
        )
      `);

    console.log("💾 Payment logged to SQL Server");

  } catch (err) {
    console.error("SQL Error:", err);
  }
}


async function sendParentEmail(data) {
  try {
      // const transporter = nodemailer.createTransport({
      //   service: "gmail",
      //   auth: {
      //     host: "pop.gmail.com",
      //     port: 587,
      //     secure: true,          
      //     user: 'fees@alsson.com',
      //     pass: 'gwwowluzlabnfyqw',
      //   },
      // });
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 578,
        secure: true,
        auth: {
          user: "fees@alsson.com",
          pass: "gwwowluzlabnfyqw",
        },
      });
  
      const html = `
      <h2>Payment Receipt</h2>
      <p>Dear Parent,</p>
      <p>Your online payment through Amazon Payment Services (AWS - PayFort) has been successfully processed.</p>
      <p><strong>Amounting:</strong> ${(data.amount / 100).toFixed(2)} EGP</p>
      <p><strong>Your FORT ID:</strong> ${data.fort_id}</p>
      <p><strong>Transaction Reference:</strong> ${data.merchant_reference}</p>
      <p><strong>Transaction Status:</strong> ${data.response_message}</p>
      <br/>
      <p>Thank you for your purchase.</p>
    `;

    await transporter.sendMail({
      from: "fees@alsson.com",
      to: data.customer_email, 
      // bcc: "feesemails@alsson.com",
      subject: "Payment Receipt",
      html
    });

    console.log("📧 Email sent");

  } catch (err) {
    console.error("Email error:", err);
  }
}

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
    const payload = req.method === "GET" ? req.query : req.body;
    console.log("Callback Payload:", payload);

    if (!payload.signature) {
      return res.status(400).send("Missing signature");
    }

    // Validate signature correctly
    const isValid = verifySignature(payload, responsePhrase);
    if (!isValid) {
      console.log("Invalid signature");
      return res.status(400).send("Invalid signature");
    }

    const isSuccess = payload.status === "14";
    if (isSuccess){
      console.log("=== Log Payment Action ===");
      logPaymentAction(payload)
      sendParentEmail(payload)
    }
    const redirectUrl =
      `http://localhost:5173/checkout-result?status=${isSuccess ? "success" : "failed"}` +
      `&amount=${payload.amount}` +
      `&fort_id=${payload.fort_id}` +
      `&merchant_reference=${payload.merchant_reference}` +
      `&response_message=${encodeURIComponent(payload.response_message || "")}` +
      `&customer_email=${encodeURIComponent(payload.customer_email || "")}`;

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

