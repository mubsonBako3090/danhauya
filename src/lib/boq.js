import PDFDocument from "pdfkit";

function money(value) {
  return `N${Number(value || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function unitLabel(item) {
  const department = item.requestingDepartment || "-";
  const faculty = item.requestingFacultyId || "-";
  const college = item.requestingCollegeId || "-";
  return `${department} / ${faculty} / ${college}`;
}

export function generateBOQPDF(requisition, requesterUser) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 32,
        bufferPages: true,
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(16).text("KADUNA STATE UNIVERSITY", { align: "center" });
      doc.fontSize(13).text("BILL OF QUANTITIES", { align: "center" });
      doc.moveDown();
      doc.fontSize(8.5)
        .text(`Requisition No: ${requisition.requisitionNumber || "-"}`)
        .text(`Requester: ${requesterUser?.fullName || requisition.requester?.fullName || "-"}`)
        .text(`Procurement Market Survey Revision: ${requisition.procurementRevision || 0}`)
        .text(`Date: ${new Date().toLocaleDateString("en-NG")}`);

      if (requisition.isConsolidated) {
        doc.moveDown(.4);
        doc.font("Helvetica-Bold").text(
          `CONSOLIDATED REQUIREMENTS: ${requisition.sourceRequisitions?.length || 0} source requisition(s), ${requisition.requestingUnits?.length || 0} requesting unit(s)`
        );
        doc.font("Helvetica");
      }
      doc.moveDown();

      const cols = [
        ["S/N", 28],
        ["Requesting Unit", 150],
        ["Description", 205],
        ["Qty", 45],
        ["Requested Unit", 78],
        ["Market Unit", 78],
        ["Market Total", 88],
        ["Reason / Note", 105],
      ];
      const xs = [];
      let cursor = 32;
      for (const [, width] of cols) { xs.push(cursor); cursor += width; }

      const contentBottom = () => doc.page.height - doc.page.margins.bottom - 30;
      const drawHeader = () => {
        const headerY = doc.y;
        doc.fontSize(7.5).font("Helvetica-Bold");
        cols.forEach(([label, width], i) => {
          doc.text(label, xs[i], headerY, { width, align: i >= 3 && i <= 6 ? "right" : "left" });
        });
        doc.moveDown(.8);
        doc.moveTo(32, doc.y).lineTo(809, doc.y).stroke();
        doc.moveDown(.35);
        doc.font("Helvetica");
      };

      drawHeader();
      let grand = 0;
      const items = Array.isArray(requisition.items) ? requisition.items : [];
      items.forEach((item, index) => {
        const requested = Number(item.requestedUnitCost ?? item.unitCost ?? 0);
        const market = Number(item.procurementUnitCost ?? item.unitCost ?? 0);
        const qty = Number(item.quantity || 0);
        const total = qty * market;
        grand += total;

        const values = [
          String(index + 1),
          unitLabel(item),
          String(item.name || "-"),
          String(qty),
          money(requested),
          money(market),
          money(total),
          String(item.procurementNote || "-"),
        ];

        const rowHeight = Math.max(
          14,
          doc.heightOfString(values[1], { width: cols[1][1] - 4, font: "Helvetica", fontSize: 7.5 }),
          doc.heightOfString(values[2], { width: cols[2][1] - 4, font: "Helvetica", fontSize: 7.5 }),
          doc.heightOfString(values[7], { width: cols[7][1] - 4, font: "Helvetica", fontSize: 7.5 })
        ) + 5;

        if (doc.y + rowHeight > contentBottom()) {
          doc.addPage();
          drawHeader();
        }

        const y = doc.y;
        values.forEach((value, i) => {
          doc.fontSize(7.5).font("Helvetica").text(value, xs[i], y, {
            width: cols[i][1] - 4,
            align: i >= 3 && i <= 6 ? "right" : "left",
          });
        });
        doc.y = y + rowHeight;
      });

      doc.moveDown();
      if (doc.y + 30 > contentBottom()) doc.addPage();
      doc.font("Helvetica-Bold").text(`GRAND TOTAL: ${money(grand)}`, { align: "right" });

      if (requisition.procurementNotes) {
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Procurement Notes");
        doc.font("Helvetica").text(requisition.procurementNotes);
      }

      if (requisition.isConsolidated && requisition.sourceRequisitions?.length) {
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Source Requisitions");
        doc.font("Helvetica").text(
          requisition.sourceRequisitions.map((id) => id?.requisitionNumber || String(id)).join(", ")
        );
      }

      const range = doc.bufferedPageRange();
      for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex++) {
        doc.switchToPage(pageIndex);
        doc.fontSize(7).font("Helvetica").fillColor("gray").text(
          `Kaduna State University - Bill of Quantities | Page ${pageIndex + 1} of ${range.count}`,
          32,
          doc.page.height - 22,
          { width: doc.page.width - 64, align: "center" }
        );
        doc.fillColor("black");
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
