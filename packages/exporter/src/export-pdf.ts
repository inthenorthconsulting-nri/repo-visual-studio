import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export interface ExportPdfOptions {
  sceneCount: number;
}

export async function exportHtmlToPdf(
  htmlPath: string,
  outPath: string,
  options: ExportPdfOptions,
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(pathToFileURL(htmlPath).toString());
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(50);

    await page.pdf({
      path: outPath,
      width: "1280px",
      height: "720px",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      pageRanges: `1-${options.sceneCount}`,
    });
  } finally {
    await browser.close();
  }
}
