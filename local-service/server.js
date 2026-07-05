const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 4850;

let printQueue = [];

app.get("/", (req, res) => {
  res.json({
    service: "B-POS Local Service",
    status: "running",
    version: "1.0.0",
  });
});

app.get("/queue", (req, res) => {
  res.json(printQueue);
});

app.post("/print", (req, res) => {
  const job = {
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    ...req.body,
  };

  printQueue.push(job);

  console.log("==============");
  console.log("Nuevo trabajo");
  console.log(job.station);
  console.log(job.printerName);
  console.log(job.content);
  console.log("==============");

  res.json({
    success: true,
    job,
  });
});

app.delete("/queue", (req, res) => {
  printQueue = [];

  res.json({
    success: true,
  });
});

app.get("/printers", (req, res) => {
  exec("lpstat -v || lpstat -p || system_profiler SPPrintersDataType", (error, stdout) => {
    if (error) {
      return res.json({
        success: false,
        printers: [],
        error: error.message,
      });
    }

    res.json({
      success: true,
      raw: stdout,
    });
  });
});

app.listen(PORT, () => {
  console.log("");
  console.log("==================================");
  console.log(" B-POS Local Service iniciado");
  console.log(` Puerto: ${PORT}`);
  console.log("==================================");
});