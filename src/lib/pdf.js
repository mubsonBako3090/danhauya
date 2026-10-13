import PDFDocument from "pdfkit";

import { ROLE_LABELS } from "@/constants/roles";
import { REQUISITION_STATUS_LABELS } from "@/constants/requisitionOptions";

/**
 * Convert a value into a safe string for PDFKit.
 */
function safeText(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
}

/**
 * Format a Nigerian Naira amount.
 */
function formatCurrency(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "N0.00";
  }

  return `N${number.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a date safely.
 */
function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Generate a PDF for a procurement requisition.
 *
 * @param {Object} requisition
 * @param {Object|null} requesterUser
 * @returns {Promise<Buffer>}
 */
export function generateRequisitionPDF(
  requisition,
  requesterUser,
  documentType = "standard"
) {
  return new Promise((resolve, reject) => {
    let doc;

    try {
      /*
       * --------------------------------------------------
       * VALIDATE INPUT
       * --------------------------------------------------
       */
      if (!requisition) {
        throw new Error("Requisition data is missing.");
      }

      /*
       * --------------------------------------------------
       * CREATE PDF DOCUMENT
       * --------------------------------------------------
       */
      doc = new PDFDocument({
        size: "A4",
        margin: 50,
        bufferPages: true,
        info: {
          Title: documentType === "procurement"
            ? "Accepted Procurement Hand-off Document"
            : "Procurement Requisition",
          Author: "Kaduna State University",
          Subject: "Digital Procurement Requisition",
        },
      });

      const chunks = [];

      /*
       * --------------------------------------------------
       * COLLECT PDF DATA
       * --------------------------------------------------
       */
      doc.on("data", (chunk) => {
        chunks.push(chunk);
      });

      /*
       * --------------------------------------------------
       * PDF COMPLETED
       * --------------------------------------------------
       */
      doc.on("end", () => {
        try {
          const pdfBuffer = Buffer.concat(chunks);

          if (!pdfBuffer.length) {
            reject(new Error("Generated PDF is empty."));
            return;
          }

          resolve(pdfBuffer);
        } catch (error) {
          reject(error);
        }
      });

      /*
       * --------------------------------------------------
       * PDF ERROR
       * --------------------------------------------------
       */
      doc.on("error", (error) => {
        reject(error);
      });

      /*
       * --------------------------------------------------
       * HEADER
       * --------------------------------------------------
       */
      doc
        .fontSize(18)
        .font("Helvetica-Bold")
        .text("Kaduna State University", {
            align: "center",
          }
        );

      doc
        .fontSize(13)
        .font("Helvetica")
        .text(
          documentType === "procurement"
            ? "Accepted Procurement Hand-off Document"
            : "Digital Procurement Requisition",
          {
          align: "center",
        });

      doc.moveDown(1);

      /*
       * Horizontal line
       */
      doc
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();

      doc.moveDown(1);

      /*
       * --------------------------------------------------
       * BASIC REQUISITION INFORMATION
       * --------------------------------------------------
       */
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Requisition Information");

      doc.moveDown(0.4);

      doc
        .fontSize(10)
        .font("Helvetica");

      doc.text(
        `Requisition No: ${safeText(
          requisition.requisitionNumber,
          "DRAFT"
        )}`
      );

      const status =
        REQUISITION_STATUS_LABELS?.[requisition.status] ||
        requisition.status ||
        "-";

      doc.text(`Status: ${safeText(status)}`);

      doc.text(
        `Requester: ${safeText(
          requesterUser?.fullName
        )}`
      );

      doc.text(
        `Department: ${safeText(
          requisition.department
        )}`
      );

      doc.text(
        `Category: ${safeText(
          requisition.category
        )}`
      );

      if (requisition.isConsolidated) {
        doc.text("Record Type: Consolidated Requisition");
        if (requisition.consolidatedAt) {
          doc.text(`Consolidated: ${formatDate(requisition.consolidatedAt)}`);
        }
        if (requisition.consolidatedBy?.fullName) {
          doc.text(`Consolidated By: ${safeText(requisition.consolidatedBy.fullName)}`);
        }
      }

      doc.text(
        `Urgency: ${safeText(
          requisition.urgency
        )}`
      );

      doc.text(
        `Created: ${formatDate(
          requisition.createdAt
        )}`
      );

      if (requisition.submittedAt) {
        doc.text(
          `Submitted: ${formatDate(
            requisition.submittedAt
          )}`
        );
      }

      doc.moveDown(1);

      /*
       * --------------------------------------------------
       * PURPOSE / JUSTIFICATION
       * --------------------------------------------------
       */
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Purpose / Justification");

      doc.moveDown(0.4);

      doc
        .fontSize(10)
        .font("Helvetica")
        .text(
          safeText(requisition.purpose),
          {
            width: 495,
            align: "left",
          }
        );

      doc.moveDown(1);

      /*
       * --------------------------------------------------
       * ITEMS
       * --------------------------------------------------
       */
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Requested Items");

      doc.moveDown(0.5);

      const items = Array.isArray(requisition.items)
        ? requisition.items
        : [];

      if (items.length === 0) {
        doc
          .fontSize(10)
          .font("Helvetica")
          .text("No items have been added.");
      } else {
        const contentBottom = () => doc.page.height - doc.page.margins.bottom - 75;
        const drawTableHeader = () => {
          const headerY = doc.y;
          doc.fontSize(9).font("Helvetica-Bold");
          doc.text("No.", 50, headerY, { width: 30 });
          doc.text("Item", 85, headerY, { width: 210 });
          doc.text("Qty", 300, headerY, { width: 45, align: "right" });
          doc.text("Unit Cost", 350, headerY, { width: 85, align: "right" });
          doc.text("Total", 440, headerY, { width: 105, align: "right" });
          doc.moveDown(0.6);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
          doc.moveDown(0.5);
          doc.font("Helvetica");
        };

        drawTableHeader();
        let calculatedTotal = 0;

        items.forEach((item, index) => {
          const itemName = safeText(item?.name);
          const quantity = Number(item?.quantity) || 0;
          const unitCost = Number(
            documentType === "procurement"
              ? (item?.procurementUnitCost ?? item?.unitCost)
              : item?.unitCost
          ) || 0;
          const explicitTotal = Number(
            documentType === "procurement"
              ? item?.procurementTotalCost
              : item?.totalCost
          );
          const totalCost = Number.isFinite(explicitTotal) && explicitTotal > 0
            ? explicitTotal
            : quantity * unitCost;
          calculatedTotal += totalCost;

          const nameHeight = doc.heightOfString(itemName, { width: 205, font: "Helvetica", fontSize: 9 });
          const rowHeight = Math.max(16, nameHeight + 6);
          if (doc.y + rowHeight > contentBottom()) {
            doc.addPage();
            drawTableHeader();
          }

          const rowY = doc.y;
          doc.fontSize(9).font("Helvetica");
          doc.text(String(index + 1), 50, rowY, { width: 30 });
          doc.text(itemName, 85, rowY, { width: 205 });
          doc.text(String(quantity), 300, rowY, { width: 45, align: "right" });
          doc.text(formatCurrency(unitCost), 350, rowY, { width: 85, align: "right" });
          doc.text(formatCurrency(totalCost), 440, rowY, { width: 105, align: "right" });
          doc.y = rowY + rowHeight;
        });

        doc.moveDown(0.5);
        if (doc.y + 30 > contentBottom()) doc.addPage();
        doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
        doc.moveDown(0.6);

        const estimatedCost = Number(requisition.estimatedCost);
        const displayTotal = documentType === "procurement"
          ? calculatedTotal
          : Number.isFinite(estimatedCost) && estimatedCost > 0
            ? estimatedCost
            : calculatedTotal;
        doc.fontSize(11).font("Helvetica-Bold").text(
          `Estimated Total: ${formatCurrency(displayTotal)}`,
          { align: "right" }
        );
      }

      doc.moveDown(1);

      if (documentType === "procurement") {
        doc.moveDown(1);

        doc
          .fontSize(11)
          .font("Helvetica-Bold")
          .text("Procurement Hand-off");

        doc.moveDown(0.4);
        doc
          .fontSize(10)
          .font("Helvetica")
          .text("Status: ACCEPTED")
          .text("Purpose: Ready for the subsequent Procurement process outside this system.");

        if (requisition.consolidatedBy) {
          const consolidatorName = requisition.consolidatedBy.fullName || requesterUser?.fullName || "Unknown";
          const consolidatorRole = requisition.consolidatedBy.role || "Procurement";
          doc.text(`Consolidated By: ${safeText(consolidatorName)} (${safeText(consolidatorRole)})`);
        }

        const sources = Array.isArray(requisition.sourceRequisitions)
          ? requisition.sourceRequisitions
          : [];

        if (sources.length) {
          doc.moveDown(0.4);
          doc.font("Helvetica-Bold").text("Source Requisitions");
          doc.font("Helvetica");
          sources.forEach((source, index) => {
            doc.text(`${index + 1}. ${safeText(source.requisitionNumber || source._id)}`);
          });
        }

        doc.moveDown(0.4);
        doc
          .font("Helvetica-Oblique")
          .text("This document records an accepted Procurement requisition/consolidation and is not evidence that downstream tendering, vendor selection, LPO issuance, contracting, or other subsequent procurement activities have been completed.");
      }

      /*
       * --------------------------------------------------
       * APPROVAL CHAIN
       * --------------------------------------------------
       */
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .text("Approval Chain");

      doc.moveDown(0.4);

      const approvalChain = Array.isArray(
        requisition.approvalChain
      )
        ? requisition.approvalChain
        : [];

      if (approvalChain.length === 0) {
        doc
          .fontSize(10)
          .font("Helvetica")
          .text("No approval chain has been assigned.");
      } else {
        approvalChain.forEach((step, index) => {
          const role =
            ROLE_LABELS?.[step?.role] ||
            step?.role ||
            "Unknown role";

          const type =
            step?.type === "processing"
              ? "Processing"
              : "Approval";

          doc
            .fontSize(10)
            .font("Helvetica")
            .text(
              `${index + 1}. ${safeText(
                role
              )} (${type})`
            );
        });
      }

      /*
       * --------------------------------------------------
       * PROCUREMENT INFORMATION
       * --------------------------------------------------
       */
      if (requisition.procurementStatus) {
        doc.moveDown(1);

        doc
          .fontSize(11)
          .font("Helvetica-Bold")
          .text("Procurement Processing");

        doc.moveDown(0.4);

        doc
          .fontSize(10)
          .font("Helvetica")
          .text(
            `Procurement Status: ${safeText(
              requisition.procurementStatus
            )}`
          );

        if (requisition.procurementReceivedAt) {
          doc.text(
            `Received: ${formatDate(
              requisition.procurementReceivedAt
            )}`
          );
        }

        if (requisition.procurementStartedAt) {
          doc.text(
            `Processing Started: ${formatDate(
              requisition.procurementStartedAt
            )}`
          );
        }

        if (requisition.procurementCompletedAt) {
          doc.text(
            `Processing Completed: ${formatDate(
              requisition.procurementCompletedAt
            )}`
          );
        }
      }

      /*
       * --------------------------------------------------
       * FOOTER
       * --------------------------------------------------
       */
      const range = doc.bufferedPageRange();

      for (
        let pageIndex = range.start;
        pageIndex < range.start + range.count;
        pageIndex++
      ) {
        doc.switchToPage(pageIndex);

        doc
          .fontSize(8)
          .font("Helvetica")
          .fillColor("gray")
          .text(
            `Kaduna State University - Digital Procurement Requisition`,
            50,
            760,
            {
              width: 495,
              align: "center",
            }
          );

        doc.text(
          `Page ${pageIndex + 1} of ${range.count}`,
          50,
          775,
          {
            width: 495,
            align: "center",
          }
        );

        doc.fillColor("black");
      }

      /*
       * --------------------------------------------------
       * FINALIZE PDF
       * --------------------------------------------------
       */
      doc.end();
    } catch (error) {
      /*
       * Catch synchronous PDFKit errors.
       */
      reject(error);
    }
  });
                             }
