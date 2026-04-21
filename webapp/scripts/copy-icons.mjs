import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");

if (!existsSync(distDir)) {
	console.error("dist directory does not exist. Run vite build first.");
	process.exit(1);
}

const ICON_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);
const EXTRA_FILES = new Set(["site.webmanifest"]);

const isIconFile = (name) => {
	const lower = name.toLowerCase();
	for (const ext of ICON_EXTENSIONS) {
		if (lower.endsWith(ext)) return true;
	}
	return false;
};

const entries = readdirSync(root, { withFileTypes: true });
let copied = 0;

for (const entry of entries) {
	if (!entry.isFile()) continue;
	if (!isIconFile(entry.name) && !EXTRA_FILES.has(entry.name)) continue;

	const source = join(root, entry.name);
	const destination = join(distDir, entry.name);
	if (!statSync(source).isFile()) continue;
	cpSync(source, destination, { force: true });
	copied += 1;
}

console.log(`Copied ${copied} icon/image file(s) to dist.`);
