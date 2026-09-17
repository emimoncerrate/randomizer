const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "data.db");
const INDEX_PATH = path.join(__dirname, "index.html");
const CLASS_COUNT = 6;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const EXAMPLE_ROSTERS = [
  ["Ava Thompson","Marcus Lee","Sofia Ramirez","Ethan Brooks","Priya Patel","Noah Kim","Isabella Garcia","Liam Johnson","Maya Chen","Jackson Wright"],
  ["Grace Miller","Diego Alvarez","Chloe Anderson","Tyler Robinson","Amara Okafor","Ryan Foster","Nina Petrov","Owen Clarke","Layla Hassan","Mason Reed"],
  ["Ella Turner","Hunter Scott","Aaliyah Jackson","Logan Murphy","Sofia Rossi","Elijah Cooper","Ruby Collins","Adrian Torres","Camille Boyd"],
  ["Harper Davis","Wyatt Sullivan","Nora Kim","Sebastian Cruz","Ivy Parker","Julian Ross","Willow Grant","Xavier Bell"],
  ["Piper Hughes","Roman Fisher","Sienna Walsh","Cole Barrett","Freya Nolan","Dominic Price","Autumn Reyes","Felix Chambers"],
  ["Delilah Morgan","Gabriel Stone","Quinn Ashford","Theo Marshall","Wren Ellison","Micah Stanton","Poppy Whitfield","Silas Donovan"]
];

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

function uid(prefix){ return prefix + "_" + Math.random().toString(36).slice(2, 10); }

function makeDefaultState(){
  const classes = EXAMPLE_ROSTERS.map(function(names, i){
    const roster = names.map(function(name){ return { id: uid("s"), name: name, absent: false }; });
    return {
      id: uid("c"),
      name: "Class " + (i + 1),
      roster: roster,
      remaining: roster.map(function(s){ return s.id; }),
      history: [],
      lastPick: null
    };
  });
  return { classes: classes, activeIndex: 0, muted: false, bannerDismissed: false, isExampleData: true };
}

function saveStateToDb(state){
  const data = JSON.stringify(state);
  db.prepare(`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(data, Date.now());
}

function getState(){
  const row = db.prepare("SELECT data FROM app_state WHERE id = 1").get();
  if (!row){
    const initial = makeDefaultState();
    saveStateToDb(initial);
    return initial;
  }
  return JSON.parse(row.data);
}

function sendJson(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function readJsonBody(req){
  return new Promise(function(resolve, reject){
    var chunks = [];
    var size = 0;
    req.on("data", function(chunk){
      size += chunk.length;
      if (size > MAX_BODY_BYTES){
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function(){
      try{
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null);
      }catch(e){
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function isValidState(body){
  return !!body
    && Array.isArray(body.classes)
    && body.classes.length === CLASS_COUNT
    && body.classes.every(function(cls){
      return cls && typeof cls.name === "string" && Array.isArray(cls.roster) && Array.isArray(cls.remaining) && Array.isArray(cls.history);
    });
}

const server = http.createServer(function(req, res){
  const url = (req.url || "/").split("?")[0];

  if (req.method === "GET" && url === "/api/state"){
    try{
      sendJson(res, 200, getState());
    }catch(e){
      sendJson(res, 500, { error: "Failed to load state" });
    }
    return;
  }

  if (req.method === "PUT" && url === "/api/state"){
    readJsonBody(req).then(function(body){
      if (!isValidState(body)){
        sendJson(res, 400, { error: "Invalid state payload" });
        return;
      }
      saveStateToDb(body);
      sendJson(res, 200, { ok: true });
    }).catch(function(){
      sendJson(res, 400, { error: "Invalid JSON body" });
    });
    return;
  }

  if (req.method === "GET" && (url === "/" || url === "/index.html")){
    fs.readFile(INDEX_PATH, function(err, buf){
      if (err){
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Failed to load page");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buf);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, function(){
  console.log("Class Roulette running at http://localhost:" + PORT);
});
