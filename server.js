import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";

dotenv.config(); // ✅ load .env here

const app = express();
app.use(express.json());
app.use(cors()); // ✅ Enable CORS

const apiKey = process.env.GEMINI_API_KEY;

app.post("/ask-ai", async (req, res) => {
    const query = req.body.query;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: query }] }]
            })
        }
    );

    const data = await response.json();
    res.json(data);
});

app.listen(3000, () => console.log("Server running on port 3000"));