/* eslint-disable jsx-a11y/alt-text -- this is @react-pdf/renderer's PDF-only <Image>, not an HTML <img>; it has no alt prop */
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitHelvetica from "pdfkit/standard-fonts/Helvetica";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesRoman from "pdfkit/standard-fonts/TimesRoman";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesBold from "pdfkit/standard-fonts/TimesBold";
// @ts-expect-error - no type declarations for pdfkit's per-font subpath exports
import PdfkitTimesItalic from "pdfkit/standard-fonts/TimesItalic";

// Server-only — generates the "export all mood boards" PDF
// (app/api/projects/[id]/mood-boards/export/route.ts). Same structure and
// same reasoning for the 4 unused-looking imports below as
// lib/houseBookPdf.tsx — see that file's own comment for the full
// explanation; the short version is that each file whose own compiled
// output needs to carry these exact pdfkit standard-font modules needs its
// own literal import of them, since @react-pdf/renderer is a server
// external package webpack never looks inside.
void [PdfkitHelvetica, PdfkitTimesRoman, PdfkitTimesBold, PdfkitTimesItalic];

export interface MoodBoardPdfRoom {
  roomName: string;
  notes: string | null;
  // Always an embeddable data: URI by the time this is rendered — prepared
  // by the caller via toEmbeddablePhoto (lib/houseBookPdf.tsx) for an
  // already-generated collage, or encoded directly from the in-memory PNG
  // buffer for one generated on the fly during export.
  collageDataUri: string;
}

export interface MoodBoardPdfInput {
  projectName: string;
  projectAddress: string | null;
  rooms: MoodBoardPdfRoom[];
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
  boardImage: {
    width: "100%",
    height: 460,
    objectFit: "contain",
  },
  notes: {
    fontFamily: "Times-Italic",
    fontSize: 11,
    color: "#5b6470",
    marginTop: 14,
  },
});

function PageChrome({ projectName }: { projectName: string }) {
  return (
    <>
      <View style={styles.header} fixed>
        <Text>{projectName}</Text>
        <Text>Mood Boards</Text>
      </View>
      <Text style={styles.footer} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
    </>
  );
}

export function MoodBoardPdfDocument({ input }: { input: MoodBoardPdfInput }) {
  const { projectName, projectAddress, rooms } = input;

  return (
    <Document title={`${projectName} — Mood Boards`} author="Alaia Homes Dev">
      <Page size="LETTER" style={styles.coverPage}>
        <View style={styles.coverFill}>
          <Text style={styles.coverKicker}>MOOD BOARDS</Text>
          <Text style={styles.coverTitle}>{projectName}</Text>
          <View style={styles.coverRule} />
          {projectAddress && <Text style={styles.coverAddress}>{projectAddress}</Text>}
        </View>
      </Page>

      {rooms.map((r, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          <PageChrome projectName={projectName} />
          <Text style={styles.sectionTitle}>{r.roomName}</Text>
          <View style={styles.sectionRule} />
          <Image src={r.collageDataUri} style={styles.boardImage} />
          {r.notes && <Text style={styles.notes}>{r.notes}</Text>}
        </Page>
      ))}
    </Document>
  );
}

export async function renderMoodBoardPdf(input: MoodBoardPdfInput): Promise<Buffer> {
  return renderToBuffer(<MoodBoardPdfDocument input={input} />);
}
