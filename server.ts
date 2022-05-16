import { encode as base64Encode } from "base64";
import { debounce } from "debounce";
import * as path from "path";
import { transform } from "swc";
import { config } from "dotenv";

const env = config({ safe: true });
const ALLOWED = [".js", ".script", ".ns", ".txt"];
const ROOT_DIR = path.dirname(path.fromFileUrl(Deno.mainModule));
const HOME_DIR = path.join(ROOT_DIR, "home");

async function updateFileHeader(filepath: string, ramUsage: number) {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  const fileEncoded = await Deno.readFile(filepath);
  const file = decoder.decode(fileEncoded);
  const usageText = `// Ram usage: ${ramUsage}GB`;

  // Exact match, do nothing to prevent watch loop
  if (file.includes(usageText)) return;

  if (file.includes(`// Ram usage: `)) {
    Deno.writeFile(
      filepath,
      encoder.encode(file.replace(/\/\/ Ram usage:\ (.*)/, usageText))
    );
  } else {
    Deno.writeFile(filepath, encoder.encode(usageText + "\n\n" + file));
  }
}

function fixFilename(filename: string) {
  // Reject invalid name
  if (filename.includes(" ")) return false;

  if (filename.includes("/") && !filename.startsWith("/")) {
    filename = "/" + filename;
  }
  return filename.replace(".ts", ".js");
}

function fixFileContent(code: string) {
  // replace .ts imports with .js
  // Fix absolute import paths in the game
  return code.replaceAll('.ts";', '.js";').replaceAll('from "@/', 'from "/');
}

async function syncFile(filepath: string) {
  const relativePath = path.relative(HOME_DIR, filepath);
  const filename = fixFilename(relativePath);
  // console.log(`${filepath} -> ${filename}`);

  if (!filename) {
    return console.log(
      `Failed to copy "${relativePath}" please check file name.`
    );
  }

  if (!ALLOWED.includes(path.extname(filename))) {
    console.log(`${filename} not allowed to sync to Bitburner`);
    return;
  }

  const decoder = new TextDecoder("utf-8");
  const file = await Deno.readFile(filepath).catch(() => {});
  if (!file) {
    return console.log(`Failed to copy ${relativePath}, could not read file`);
  }

  const { code } = transform(decoder.decode(file), {
    jsc: {
      target: "es2021",
      parser: {
        syntax: "typescript",
      },
    },
  } as any);

  const body = JSON.stringify({
    filename,
    code: base64Encode(fixFileContent(code)),
  });

  const res = await fetch(`http://${env.HOST}:${env.PORT}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": body.length.toString(),
      Authorization: `Bearer ${env.TOKEN}`,
    },
    body,
  });

  if (res.status === 200) {
    const result = await res.json();
    if (result.success === true) {
      console.log(
        `File saved in Bitburner ${filename} (${result.data.ramUsage}GB Ram)`
      );
      updateFileHeader(filepath, result.data.ramUsage);
    }
  } else {
    console.log(res.status, res.statusText);
  }
}

const debounced = debounce(syncFile, 100);
const watcher = Deno.watchFs(HOME_DIR);

for await (const event of watcher) {
  if (event.kind === "modify") {
    // console.log(`> ${event.kind} ${event.paths.join(", ")}`);
    const last = event.paths[event.paths.length - 1];
    debounced(last);
  }
}
