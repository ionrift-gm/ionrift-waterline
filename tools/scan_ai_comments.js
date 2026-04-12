const fs = require('fs');
const path = require('path');

// CI copy: logic matches ionrift-devtools/scripts/scan_ai_comments.js.
// When ionrift-gm/ionrift-devtools is public, workflow may switch back to checkout.

const TARGET_DIR = process.argv[2] || path.resolve(__dirname, '../scripts');
const REPO_ROOT = path.resolve(__dirname, '..');

const AI_INDICATORS = [
    { pattern: /as an AI/i, label: "Explicit Identity" },
    { pattern: /language model/i, label: "Explicit Identity" },
    { pattern: /certainly/i, label: "Conversational Filler" },
    { pattern: /here is the/i, label: "Conversational Hand-off" },
    { pattern: /I have updated/i, label: "First-Person Update" },
    { pattern: /in this snippet/i, label: "Meta-Commentary" },
    { pattern: /below is the/i, label: "Meta-Commentary" },

    { pattern: /ensure that the/i, label: "Verbose Instruction" },
    { pattern: /this function will/i, label: "Future Tense Description" },
    { pattern: /simple utility to/i, label: "Subjective Descriptor" },
    { pattern: /prompt:/i, label: "Prompt Leak" },
    { pattern: /user:/i, label: "Conversation Leak" },
    { pattern: /assistant:/i, label: "Conversation Leak" },

    { pattern: /ionrift-cloud/i, label: "Cloud Leak" }
];

function scan(dir) {
    let findings = [];

    if (!fs.existsSync(dir)) {
        console.error(`Target directory not found: ${dir}`);
        return [];
    }

    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const relativePath = path.relative(REPO_ROOT, fullPath);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
            findings = findings.concat(scan(fullPath));
        } else {
            if (!file.endsWith('.js') && !file.endsWith('.md')) continue;

            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');

            lines.forEach((line, index) => {
                AI_INDICATORS.forEach(indicator => {
                    if (indicator.pattern.test(line)) {
                        findings.push({
                            file: relativePath,
                            line: index + 1,
                            type: indicator.label,
                            content: line.trim().substring(0, 80)
                        });
                    }
                });
            });
        }
    }
    return findings;
}

console.log(`\n--- Ionrift AI Comment Scanner ---`);
console.log(`Target: ${TARGET_DIR}\n`);

const results = scan(TARGET_DIR);

if (results.length === 0) {
    console.log("✅ No AI patterns detected.");
} else {
    console.log(`⚠️  Found ${results.length} potential AI artifacts:\n`);
    results.forEach(r => {
        console.log(`[${r.type}] ${r.file}:${r.line}`);
        console.log(`    "${r.content}"`);
    });
    console.log("\n❌ Review recommended.");
    process.exit(1);
}
