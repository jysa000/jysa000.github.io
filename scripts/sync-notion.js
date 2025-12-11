// scripts/sync-notion.js
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import dayjs from "dayjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ESModule 경로 설정용
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const n2m = new NotionToMarkdown({ notionClient: notion });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Chirpy _posts 경로
const POSTS_DIR = path.join(__dirname, "..", "_posts");

async function getDefaultDataSourceId() {
    // 1. 데이터베이스 정보 가져오기
    const db = await notion.databases.retrieve({
        database_id: DATABASE_ID,
    });

    // 2. DB 안에 연결된 data_sources 배열에서 첫 번째 사용
    const dataSource = db.data_sources?.[0];
    if (!dataSource) {
        throw new Error("이 데이터베이스에 data_sources가 없습니다. (원본 DB인지 확인 필요)");
    }

    return dataSource.id;
}

async function fetchPublishedPages() {
    // 3. data_source_id 얻기
    const dataSourceId = await getDefaultDataSourceId();

    // 4. 새 API: dataSources.query 사용
    const res = await notion.dataSources.query({
        data_source_id: dataSourceId,
        filter: {
            property: "Published",
            checkbox: { equals: true },
        },
    });

    return res.results;
}

function getProperty(page, name) {
    const prop = page.properties[name];
    if (!prop) return null;

    switch (prop.type) {
        case "title":
            return prop.title[0]?.plain_text ?? "";
        case "rich_text":
            return prop.rich_text[0]?.plain_text ?? "";
        case "date":
            return prop.date?.start ?? null;
        case "multi_select":
            return prop.multi_select.map((t) => t.name);
        case "select":
            return prop.select?.name ?? null;
        default:
            return null;
    }
}

async function pageToMarkdownFile(page) {
    const title = getProperty(page, "Title");
    const slug = getProperty(page, "Slug") || title.toLowerCase().replace(/\s+/g, "-");
    const dateStr = getProperty(page, "Date") || new Date().toISOString();
    const tags = getProperty(page, "Tags") || [];
    const category = getProperty(page, "Category") || "Blog";

    const pageId = page.id;
    const mdBlocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdBlocks).parent;

    // 날짜 포맷 맞추기 (Chirpy 파일명 규칙용)
    const date = dayjs(dateStr);
    const dateForFile = date.format("YYYY-MM-DD");
    const dateForFront = date.format("YYYY-MM-DD HH:mm:ss ZZ");

    const fileName = `${dateForFile}-${slug}.md`;
    const filePath = path.join(POSTS_DIR, fileName);

    const frontMatter = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        `date: ${dateForFront}`,
        `categories: [${category}]`,
        `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
        'math: true',
        "---",
        "",
    ].join("\n");

    const content = frontMatter + mdString;

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✅ Wrote ${fileName}`);
}

async function main() {
    if (!fs.existsSync(POSTS_DIR)) {
        fs.mkdirSync(POSTS_DIR, { recursive: true });
    }

    console.log("⏳ Fetching published pages from Notion...");
    const pages = await fetchPublishedPages();
    console.log(`Found ${pages.length} published pages.`);

    for (const page of pages) {
        await pageToMarkdownFile(page);
    }

    console.log("✅ Sync completed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
