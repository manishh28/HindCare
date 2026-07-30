const http = require("http");
const fs = require("fs");
const path = require("path");
const { handleMessage } = require("../chatbot/chatbot");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

const db = {
  hospitals: [
    {
      id: 1,
      name: "HindCare Emergency Hospital",
      city: "Lucknow",
      address: "SGPGI Road, Lucknow",
      phone: "+91-9000000001",
      emergencyAvailable: true,
      totalBeds: 120,
      availableBeds: 28,
      status: "approved"
    },
    {
      id: 2,
      name: "MedTech City Hospital",
      city: "Lucknow",
      address: "Gomti Nagar, Lucknow",
      phone: "+91-9000000002",
      emergencyAvailable: true,
      totalBeds: 80,
      availableBeds: 12,
      status: "approved"
    }
  ],
  ambulances: [
    {
      id: 1,
      registrationNumber: "UP32 AB 1001",
      type: "advanced",
      driverName: "Rahul Singh",
      phone: "+91-9111111111",
      status: "available"
    },
    {
      id: 2,
      registrationNumber: "UP32 AB 1002",
      type: "basic",
      driverName: "Amit Verma",
      phone: "+91-9222222222",
      status: "busy"
    }
  ],
  bookings: [],
  chatbotLogs: []
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function requireFields(body, fields) {
  return fields.filter(field => !String(body[field] || "").trim());
}

function nextId(items) {
  return items.length ? Math.max(...items.map(item => item.id)) + 1 : 1;
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.normalize(path.join(FRONTEND_DIR, relativePath));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(FRONTEND_DIR, "index.html"), (indexError, indexContent) => {
        if (indexError) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(indexContent);
      });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png"
    };

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { status: "ok", service: "hindcare-aggregator" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hospitals") {
    const city = url.searchParams.get("city");
    const hospitals = city
      ? db.hospitals.filter(hospital => hospital.city.toLowerCase() === city.toLowerCase())
      : db.hospitals;
    sendJson(res, 200, hospitals);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/hospitals") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["name", "city", "address", "phone"]);
    if (missing.length) {
      sendJson(res, 400, { error: "Missing required fields", fields: missing });
      return;
    }

    const hospital = {
      id: nextId(db.hospitals),
      name: body.name,
      city: body.city,
      address: body.address,
      phone: body.phone,
      emergencyAvailable: Boolean(body.emergencyAvailable ?? true),
      totalBeds: Number(body.totalBeds || 0),
      availableBeds: Number(body.availableBeds || 0),
      status: "pending"
    };
    db.hospitals.push(hospital);
    sendJson(res, 201, hospital);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ambulances") {
    sendJson(res, 200, db.ambulances);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ambulances") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["registrationNumber", "type", "driverName", "phone"]);
    if (missing.length) {
      sendJson(res, 400, { error: "Missing required fields", fields: missing });
      return;
    }

    const ambulance = {
      id: nextId(db.ambulances),
      registrationNumber: body.registrationNumber,
      type: body.type,
      driverName: body.driverName,
      phone: body.phone,
      status: "available"
    };
    db.ambulances.push(ambulance);
    sendJson(res, 201, ambulance);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    sendJson(res, 200, db.bookings);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await parseBody(req);
    const missing = requireFields(body, ["patientName", "phone", "pickup", "destination"]);
    if (missing.length) {
      sendJson(res, 400, { error: "Missing required fields", fields: missing });
      return;
    }

    const ambulance = db.ambulances.find(item => item.status === "available");
    const booking = {
      id: nextId(db.bookings),
      patientName: body.patientName,
      phone: body.phone,
      pickup: body.pickup,
      destination: body.destination,
      emergencyType: body.emergencyType || "general",
      ambulanceId: ambulance ? ambulance.id : null,
      status: ambulance ? "assigned" : "requested",
      notes: body.notes || "",
      createdAt: new Date().toISOString()
    };

    if (ambulance) {
      ambulance.status = "busy";
    }

    db.bookings.push(booking);
    sendJson(res, 201, booking);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/chatbot/message") {
    const body = await parseBody(req);
    const result = handleMessage(body.message);
    db.chatbotLogs.push({
      id: nextId(db.chatbotLogs),
      message: body.message || "",
      ...result,
      createdAt: new Date().toISOString()
    });
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => {
      sendJson(res, 400, { error: error.message });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`HindCare demo running at http://${HOST}:${PORT}`);
});
