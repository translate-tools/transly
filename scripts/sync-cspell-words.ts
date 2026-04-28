import fs from 'fs';

type ESLintMessage = {
	ruleId: string | null;
	message: string;
};

type ESLintResult = {
	messages: ESLintMessage[];
};

const extractWords = (text: string): string[] =>
	text.match(/\b[a-zA-Z][a-zA-Z0-9-]{2,}\b/g) ?? [];

const existingWords = new Set(
	fs
		.readFileSync('words.txt', 'utf8')
		.split('\n')
		.map((w) => w.trim())
		.filter(Boolean),
);

let input = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
	input += chunk as string;
});

process.stdin.on('end', () => {
	const report = JSON.parse(input) as ESLintResult[];

	const newWords = new Set<string>();

	for (const result of report) {
		for (const msg of result.messages) {
			if (msg.ruleId !== '@cspell/spellchecker') continue;

			for (const w of extractWords(msg.message)) {
				const normalized = w.toLowerCase();
				if (!existingWords.has(normalized)) {
					newWords.add(normalized);
				}
			}
		}
	}

	const merged = [...existingWords, ...newWords].sort();

	fs.writeFileSync('words.txt', merged.join('\n') + '\n');

	console.log(`Added ${newWords.size} words`);
});
