'use strict';

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');
const sanitize = require('sanitize-filename');
const TurndownService = require('turndown');

// Global statistics
const stats = {
    posts: []
};

// Initialize TurndownService with custom rules
const tds = new TurndownService({ 
    codeBlockStyle: 'fenced', 
    fence: '```',
    headingStyle: 'atx'
});

// Command line argument handling
if (process.argv.length < 4) {
    console.log('Usage: node script.js <BACKUP XML> <OUTPUT DIR> [m|s]');
    process.exit(1);
}

const inputFile = process.argv[2];
const outputDir = process.argv[3];

// Check if directory exists, if not, create it
async function ensureDirectoryExists(dir) {
    try {
        await fs.promises.mkdir(dir, { recursive: true });
    } catch (err) {
        console.error(`Error creating directory ${dir}:`, err);
    }
}

// Safe filename generation
function getFileName(text) {
    return sanitize(text)
        .replace(/[<>:"/\\|?*]+/g, '-')  // Replace invalid filename characters
        .replace(/[-]{2,}/g, '-')  // Avoid consecutive hyphens
        .trim()  // Remove leading/trailing whitespace
        .toLowerCase();  // Convert to lowercase
}

// Extract tags from entry
function extractTags(entry) {
    return entry.category 
        ? entry.category
            .filter(cat => cat.$.term !== 'http://schemas.google.com/blogger/2008/kind#post') // Exclude unwanted tag
            .map(tag => tag.$.term) 
        : [];
}

// Main blogger import function
async function bloggerImport(backupXmlFile, outputDir) {
    const parser = new xml2js.Parser();

    try {
        const data = await fs.promises.readFile(backupXmlFile);
        const result = await parser.parseStringPromise(data);

        if (!result.feed?.entry) {
            throw new Error('Invalid Blogger export file');
        }

        const contents = result.feed.entry;
        const posts = contents.filter(entry => 
            entry.id[0].includes('.post-') && 
            !entry['thr:in-reply-to']
        );

        console.log(`Found ${posts.length} posts`);

        await ensureDirectoryExists(outputDir);

        for (const entry of posts) {
            const title = entry.title[0]['_']?.replace(/'/g, "''") || 'Untitled';
            const postId = entry.id[0].split('-').pop();
            stats.posts.push({ title, id: postId });

            const published = entry.published[0];
            const draft = entry['app:control']?.[0]?.['app:draft']?.[0] === 'yes';
            const sanitizedTitle = getFileName(title);

            console.log(`Sanitized title: ${sanitizedTitle}`);

            if (!sanitizedTitle || sanitizedTitle === '-') {
                console.error(`Invalid filename for title: ${title}. Skipping post.`);
                continue; // Skip this post
            }

            let content = '';
            if (entry.content?.[0]?.['_']) {
                content = entry.content[0]['_'];
            }
            const markdown = tds.turndown(content);

            const tags = extractTags(entry);
            const tagsField = tags.length ? `tags: [${tags.map(tag => `'${tag}'`).join(', ')}]\n` : '';
            const fileHeader = `---\ntitle: '${title}'\ndate: ${published}\ndraft: ${draft}\n${tagsField}---`;

            const fname = path.join(outputDir, `${sanitizedTitle}.md`);
            await writeToFile(fname, `${fileHeader}\n\n${markdown}`);
        }

        writeSummary();  // Save summary outside of output directory
    } catch (err) {
        console.error('Error processing Blogger export:', err);
        process.exit(1);
    }
}

// Write files with proper encoding
async function writeToFile(filename, content) {
    try {
        await fs.promises.writeFile(filename, content, 'utf8');
        console.log(`Successfully written to ${filename}`);
    } catch (err) {
        console.error(`Error writing to ${filename}:`, err);
    }
}

// Write summary report outside of output directory
function writeSummary() {
    const summary = {
        totalPosts: stats.posts.length
    };

    fs.writeFileSync(
        path.join(__dirname, 'migration-summary.json'),  // Save in main folder
        JSON.stringify(summary, null, 2)
    );
}

// Start the import process
bloggerImport(inputFile, outputDir).catch(console.error);