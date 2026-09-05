/* eslint-disable jsx-a11y/alt-text -- this is @react-pdf/renderer's PDF-only <Image>, not an HTML <img>; it has no alt prop */
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelvetica from "pdfkit/standard-fonts/Helvetica";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesRoman from "pdfkit/standard-fonts/TimesRoman";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesBold from "pdfkit/standard-fonts/TimesBold";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesItalic from "pdfkit/standard-fonts/TimesItalic";

// Server-only — generates the House Book PDF (app/api/projects/[id]/house-book/route.ts).
// Uses the built-in base-14 PDF fonts only (Times/Helvetica) rather than
// registering a downloaded font — one less thing that can fail mid-request,
// and Times-Roman headings already give it a "book" feel without one.
//
// The 4 imports above are otherwise unused — they exist purely to force
// these exact pdfkit standard-font modules into THIS file's own compiled
// output. pdfkit itself only ever reaches them via a computed require
// (`pdfkit/standard-fonts/<name>`) deep inside its own font-loading code,
// which (a) Vercel's static file-tracing can't follow — even after
// forcing every route's trace to carry pdfkit's whole file tree via
// next.config.js's outputFileTracingIncludes, "Cannot find module
// .../standard-fonts/Helvetica.cjs" still happened in production — and
// (b) is invisible to webpack in the first place since @react-pdf/renderer
// is registered as a server-external package (next.config.js), so webpack
// never even looks inside it to begin with. A literal import of the exact
// subpath from this file — which is NOT external — sidesteps both: these
// four modules get bundled directly into this route's own output, so
// nothing needs to be traced or resolved against pdfkit at request time
// at all.
void [PdfkitHelvetica, PdfkitTimesRoman, PdfkitTimesBold, PdfkitTimesItalic];

export interface HouseBookImage {
  url: string;
  caption: string;
}

export interface HouseBookSubcontractor {
  company_name: string;
  trade: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  license_number: string | null;
  license_state: string | null;
  license_status: string | null;
}

export interface HouseBookInput {
  projectName: string;
  projectAddress: string | null;
  planPages: HouseBookImage[];
  images: HouseBookImage[];
  landscape: HouseBookImage[];
  subcontractors: HouseBookSubcontractor[];
  closingNote: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 11,
    color: "#2b2b2b",
  },
  coverPage: {
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    fontFamily: "Helvetica",
  },
  coverFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f2a37",
  },
  coverKicker: {
    fontFamily: "Times-Italic",
    fontSize: 13,
    color: "#c9a24b",
    letterSpacing: 2,
    marginBottom: 14,
  },
  coverTitle: {
    fontFamily: "Times-Bold",
    fontSize: 34,
    color: "#ffffff",
    textAlign: "center",
    marginHorizontal: 40,
  },
  coverAddress: {
    fontFamily: "Times-Roman",
    fontSize: 14,
    color: "#d7dce2",
    marginTop: 16,
    textAlign: "center",
  },
  coverRule: {
    width: 60,
    height: 1.5,
    backgroundColor: "#c9a24b",
    marginTop: 24,
    marginBottom: 24,
  },
  header: {
    position: "absolute",
    top: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8.5,
    color: "#9aa0a6",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dcdfe3",
    paddingBottom: 6,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    textAlign: "center",
    fontSize: 8.5,
    color: "#9aa0a6",
  },
  sectionTitle: {
    fontFamily: "Times-Bold",
    fontSize: 20,
    color: "#1f2a37",
    marginBottom: 4,
  },
  sectionRule: {
    width: 36,
    height: 2,
    backgroundColor: "#c9a24b",
    marginBottom: 18,
  },
  fullImage: {
    width: "100%",
    height: 420,
    objectFit: "cover",
    borderRadius: 2,
  },
  imageCaption: {
    fontFamily: "Times-Italic",
    fontSize: 11,
    color: "#5b6470",
    marginTop: 10,
    textAlign: "center",
  },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
  },
  gridItem: {
    width: "48%",
  },
  gridImage: {
    width: "100%",
    height: 190,
    objectFit: "cover",
    borderRadius: 2,
  },
  gridCaption: {
    fontFamily: "Times-Italic",
    fontSize: 9.5,
    color: "#5b6470",
    marginTop: 6,
    textAlign: "center",
  },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: "#dcdfe3",
    paddingVertical: 10,
  },
  subCompany: {
    fontFamily: "Times-Bold",
    fontSize: 12,
    color: "#1f2a37",
  },
  subTrade: {
    fontSize: 9.5,
    color: "#9aa0a6",
    marginTop: 2,
  },
  subContact: {
    fontSize: 9.5,
    color: "#5b6470",
    textAlign: "right",
  },
  closingPage: {
    justifyContent: "center",
  },
  closingKicker: {
    fontFamily: "Times-Italic",
    fontSize: 12,
    color: "#c9a24b",
    textAlign: "center",
    marginBottom: 18,
    letterSpacing: 1,
  },
  closingText: {
    fontFamily: "Times-Roman",
    fontSize: 13,
    lineHeight: 1.7,
    color: "#2b2b2b",
    marginHorizontal: 20,
  },
});

function PageChrome({ projectName }: { projectName: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text>{projectName}</Text>
        <Text>House Book</Text>
      </View>
      <Text
        style={styles.footer}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        fixed
      />
    </>
  );
}

function pairUp<T>(items: T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

export function HouseBookDocument({ input }: { input: HouseBookInput }) {
  const { projectName, projectAddress, planPages, images, landscape, subcontractors, closingNote } = input;

  return (
    <Document title={`${projectName} — House Book`} author="Alaia Homes Dev">
      <Page size="LETTER" style={styles.coverPage}>
        <View style={styles.coverFill}>
          <Text style={styles.coverKicker}>THE HOUSE BOOK</Text>
          <Text style={styles.coverTitle}>{projectName}</Text>
          <View style={styles.coverRule} />
          {projectAddress && <Text style={styles.coverAddress}>{projectAddress}</Text>}
        </View>
      </Page>

      {planPages.map((p, i) => (
        <Page key={`plan-${i}`} size="LETTER" style={styles.page}>
          <PageChrome projectName={projectName} />
          {i === 0 && (
            <>
              <Text style={styles.sectionTitle}>Plans &amp; Layout</Text>
              <View style={styles.sectionRule} />
            </>
          )}
          <Image src={p.url} style={styles.fullImage} />
          <Text style={styles.imageCaption}>{p.caption}</Text>
        </Page>
      ))}

      {images.length > 0 &&
        pairUp(images).map((pair, i) => (
          <Page key={`img-${i}`} size="LETTER" style={styles.page}>
            <PageChrome projectName={projectName} />
            {i === 0 && (
              <>
                <Text style={styles.sectionTitle}>Rooms &amp; Finishes</Text>
                <View style={styles.sectionRule} />
              </>
            )}
            <View style={styles.gridWrap}>
              {pair.map((img, j) => (
                <View key={j} style={styles.gridItem}>
                  <Image src={img.url} style={styles.gridImage} />
                  <Text style={styles.gridCaption}>{img.caption}</Text>
                </View>
              ))}
            </View>
          </Page>
        ))}

      {landscape.length > 0 &&
        landscape.map((img, i) => (
          <Page key={`land-${i}`} size="LETTER" style={styles.page}>
            <PageChrome projectName={projectName} />
            {i === 0 && (
              <>
                <Text style={styles.sectionTitle}>Landscape</Text>
                <View style={styles.sectionRule} />
              </>
            )}
            <Image src={img.url} style={styles.fullImage} />
            <Text style={styles.imageCaption}>{img.caption}</Text>
          </Page>
        ))}

      {subcontractors.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <PageChrome projectName={projectName} />
          <Text style={styles.sectionTitle}>Your Team</Text>
          <View style={styles.sectionRule} />
          {subcontractors.map((s, i) => (
            <View key={i} style={styles.subRow}>
              <View>
                <Text style={styles.subCompany}>{s.company_name}</Text>
                {(s.trade || s.license_number) && (
                  <Text style={styles.subTrade}>
                    {[s.trade, s.license_number ? `License ${s.license_number}${s.license_state ? ` (${s.license_state})` : ""}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                )}
              </View>
              <View>
                {s.contact_name && <Text style={styles.subContact}>{s.contact_name}</Text>}
                {s.phone && <Text style={styles.subContact}>{s.phone}</Text>}
                {s.email && <Text style={styles.subContact}>{s.email}</Text>}
              </View>
            </View>
          ))}
        </Page>
      )}

      {closingNote && (
        <Page size="LETTER" style={[styles.page, styles.closingPage]}>
          <Text style={styles.closingKicker}>A NOTE ABOUT YOUR HOME</Text>
          <Text style={styles.closingText}>{closingNote}</Text>
        </Page>
      )}
    </Document>
  );
}

// @react-pdf/renderer's <Image src="https://...">  fetches the URL itself
// and sniffs the actual bytes for a JPEG/PNG/SVG signature — it does NOT
// go by file extension, and throws "Not valid image extension" for
// anything else (HEIC/HEIC from an iPhone camera, WEBP, GIF, ...), which
// crashes the whole PDF over one photo. Every source here (a directly
// uploaded plan sheet, a room photo from a phone) can realistically be in
// one of those unsupported formats, so every image is re-encoded to a JPEG
// data URI up front instead of ever handing react-pdf a remote URL to
// fetch and sniff on its own.
const MAX_EMBED_DIMENSION = 2000;

async function toEmbeddablePhoto(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(buffer)
      .rotate()
      .resize({ width: MAX_EMBED_DIMENSION, height: MAX_EMBED_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    // One bad photo (an unsupported format, a dead URL) skips that image
    // rather than failing the whole House Book — see the comment above.
    console.warn(`house-book: could not embed image, skipping (${url}):`, err);
    return null;
  }
}

async function prepareImages(items: HouseBookImage[]): Promise<HouseBookImage[]> {
  const prepared = await Promise.all(
    items.map(async (item) => {
      const embeddable = await toEmbeddablePhoto(item.url);
      return embeddable ? { url: embeddable, caption: item.caption } : null;
    })
  );
  return prepared.filter((item): item is HouseBookImage => item !== null);
}

export async function renderHouseBookPdf(input: HouseBookInput): Promise<Buffer> {
  const [planPages, images, landscape] = await Promise.all([
    prepareImages(input.planPages),
    prepareImages(input.images),
    prepareImages(input.landscape),
  ]);
  return renderToBuffer(<HouseBookDocument input={{ ...input, planPages, images, landscape }} />);
}
