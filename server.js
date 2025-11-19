app.post("/createFormPayLoad", async (req, res) => {
  try {
    const orderID = generateMerchantReference(12);
    const RqPhrase = "$2y$10$Ta0481EDF";

    let formPayLoad = {
      command: "AUTHORIZATION",
      language: "en",
      merchant_identifier: "4ada67b5",
      access_code: "M4sQwfE5v1O5QkjocgPW",
      merchant_reference: orderID,
      amount: req.body.amount * 100, // Convert to smallest currency
      currency: req.body.currency,
      customer_email: req.body.email,
      return_url: "https://httpbin.org/post",
    };

    // encrypt details if you want
    const details = `${req.body.amount},${req.body.currency},${req.body.email}`;
    const encryptedDetails = encryptOrderDetails(details, RqPhrase);
    formPayLoad.return_url += `?data=${encodeURIComponent(encryptedDetails)}`;

    // Must include amount, currency, customer_email
    formPayLoad.signature = createSignature(formPayLoad, RqPhrase);

    return res.status(200).json({
      success: true,
      message: "Signature created successfully",
      payload: formPayLoad,
    });
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
