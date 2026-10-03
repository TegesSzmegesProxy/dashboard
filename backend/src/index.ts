import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";


const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT ?? 5000;

async function start() {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
}

start().catch((err) => {
    console.error(err);
    process.exit(1);
});