export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import Requisition from "@/models/Requisition";
import Approval from "@/models/Approval";
import User from "@/models/User";
import { REQUISITION_STATUS, APPROVAL_ACTIONS } from "@/constants/requisitionOptions";
import { ROLES, APPROVER_ROLES } from "@/constants/roles";
import { PROCUREMENT_POSITIONS } from "@/constants/procurement";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

export async function GET() {
  try {
    const auth = getAuth();
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    await connectDB();

    if (auth.role === ROLES.REQUESTER) {
      const requesterFilter = { requester: auth.sub };
      const [draftCount, pendingCount, returnedCount, approvedCount, rejectedCount, totalCount] = await Promise.all([
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.DRAFT }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.PENDING }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.RETURNED }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.APPROVED }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.REJECTED }),
        Requisition.countDocuments(requesterFilter),
      ]);
      return NextResponse.json({ role: auth.role, draftCount, pendingCount, returnedCount, approvedCount, rejectedCount, totalCount });
    }

    if (auth.role === ROLES.HOD) {
      const requesterFilter = { requester: auth.sub };

      const [
        draftCount,
        pendingCount,
        returnedCount,
        approvedCount,
        rejectedCount,
        totalCount,
      ] = await Promise.all([
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.DRAFT }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.PENDING }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.RETURNED }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.APPROVED }),
        Requisition.countDocuments({ ...requesterFilter, status: REQUISITION_STATUS.REJECTED }),
        Requisition.countDocuments(requesterFilter),
      ]);

      const possiblePending = await Requisition.find({
        status: { $in: [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.RETURNED] },
        awaitingRequesterAction: { $ne: true },
        "approvalChain.approver": auth.sub,
      })
        .select("_id currentStepIndex approvalChain status awaitingRequesterAction")
        .lean();

      const pendingMyStep = possiblePending.filter((requisition) => {
        const currentStep = requisition.approvalChain?.[requisition.currentStepIndex];
        return currentStep && String(currentStep.approver) === String(auth.sub) && currentStep.type === "approval";
      }).length;

      const [approvedByMe, returnedByMe, rejectedByMe, reviewedByMe] = await Promise.all([
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.APPROVE }),
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.RETURN }),
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.REJECT }),
        Approval.countDocuments({ approver: auth.sub }),
      ]);

      return NextResponse.json({
        role: auth.role,
        draftCount,
        pendingCount,
        returnedCount,
        approvedCount,
        rejectedCount,
        totalCount,
        pendingMyStep,
        approvedByMe,
        returnedByMe,
        rejectedByMe,
        reviewedByMe,
      });
    }

    if (APPROVER_ROLES.includes(auth.role)) {
      const possiblePending = await Requisition.find({
        status: { $in: [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.RETURNED] },
        awaitingRequesterAction: { $ne: true },
        "approvalChain.approver": auth.sub,
      }).select("_id currentStepIndex approvalChain status awaitingRequesterAction").lean();

      const pendingMyStep = possiblePending.filter((requisition) => {
        const currentStep = requisition.approvalChain?.[requisition.currentStepIndex];
        return currentStep && String(currentStep.approver) === String(auth.sub) && currentStep.type === "approval";
      }).length;

      const [approvedByMe, returnedByMe, rejectedByMe, reviewedByMe] = await Promise.all([
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.APPROVE }),
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.RETURN }),
        Approval.countDocuments({ approver: auth.sub, action: APPROVAL_ACTIONS.REJECT }),
        Approval.countDocuments({ approver: auth.sub }),
      ]);

      return NextResponse.json({ role: auth.role, pendingMyStep, approvedByMe, returnedByMe, rejectedByMe, reviewedByMe });
    }

    if (auth.role === ROLES.PROCUREMENT) {
      const supervisory = [
        PROCUREMENT_POSITIONS.DIRECTOR,
        PROCUREMENT_POSITIONS.PRINCIPAL_SENIOR,
      ].includes(auth.procurementPosition);
      const isDirector = auth.procurementPosition === PROCUREMENT_POSITIONS.DIRECTOR;

      // Procurement queues are intentionally separated by stage. The dashboard
      // does not expose the old Start/Complete Processing workflow as a primary
      // queue; accepted requisitions are the hand-off point for the next
      // procurement process outside this system.
      const possible = await Requisition.find({
        status: {
          $in: [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.RETURNED, REQUISITION_STATUS.APPROVED],
        },
        awaitingRequesterAction: { $ne: true },
        consolidatedInto: { $exists: false },
      })
        .select("_id currentStepIndex approvalChain status procurementStatus procurementOfficer isConsolidated")
        .lean();

      let marketSurveyCount = 0;
      let directorReviewCount = 0;
      let awaitingVcCount = 0;
      let acceptedCount = 0;
      let acceptedConsolidatedCount = 0;
      let rejectedCount = 0;

      for (const requisition of possible) {
        const step = requisition.approvalChain?.[requisition.currentStepIndex];
        const assignedToMe = String(requisition.procurementOfficer || "") === String(auth.sub);
        const stepAssignedToMe = step && String(step.approver) === String(auth.sub);

        if (
          requisition.status === REQUISITION_STATUS.PENDING &&
          requisition.procurementStatus === "review" &&
          step?.type === "procurement_review" &&
          (supervisory || stepAssignedToMe || assignedToMe)
        ) {
          marketSurveyCount += 1;
        }

        if (
          isDirector &&
          requisition.status === REQUISITION_STATUS.PENDING &&
          requisition.procurementStatus === "director_review" &&
          step?.type === "procurement_review" &&
          stepAssignedToMe
        ) {
          directorReviewCount += 1;
        }

        if (
          requisition.status === REQUISITION_STATUS.PENDING &&
          requisition.procurementStatus === "submitted_to_vc" &&
          (supervisory || assignedToMe)
        ) {
          awaitingVcCount += 1;
        }

        // V7.12: accepted is the Procurement hand-off point. The query excludes
        // child requisitions already absorbed by a later consolidation so the
        // same requirement is not counted twice.
        if (
          requisition.status === REQUISITION_STATUS.APPROVED &&
          requisition.procurementStatus === "accepted"
        ) {
          acceptedCount += 1;
          if (requisition.isConsolidated) acceptedConsolidatedCount += 1;
        }
      }

      rejectedCount = await Requisition.countDocuments({
        status: REQUISITION_STATUS.REJECTED,
        consolidatedInto: { $exists: false },
        $or: [
          { procurementStatus: "rejected" },
          { "approvalChain.role": ROLES.PROCUREMENT },
        ],
      });

      return NextResponse.json({
        role: auth.role,
        marketSurveyCount,
        directorReviewCount,
        awaitingVcCount,
        acceptedCount,
        acceptedConsolidatedCount,
        rejectedCount,
        totalProcurementItems:
          marketSurveyCount +
          directorReviewCount +
          awaitingVcCount +
          acceptedCount,
      });
    }

    if (auth.role === ROLES.ADMIN) {
      const [totalUsers, pendingUsers, activeUsers, deactivatedUsers, totalRequisitions, activeRequisitions, draftRequisitions, pendingRequisitions, returnedRequisitions, approvedRequisitions, rejectedRequisitions] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ accountStatus: "pending" }),
        User.countDocuments({ accountStatus: "active" }),
        User.countDocuments({ accountStatus: "deactivated" }),
        Requisition.countDocuments(),
        Requisition.countDocuments({ status: { $in: [REQUISITION_STATUS.PENDING, REQUISITION_STATUS.RETURNED] } }),
        Requisition.countDocuments({ status: REQUISITION_STATUS.DRAFT }),
        Requisition.countDocuments({ status: REQUISITION_STATUS.PENDING }),
        Requisition.countDocuments({ status: REQUISITION_STATUS.RETURNED }),
        Requisition.countDocuments({ status: REQUISITION_STATUS.APPROVED }),
        Requisition.countDocuments({ status: REQUISITION_STATUS.REJECTED }),
      ]);
      return NextResponse.json({ role: auth.role, totalUsers, pendingUsers, activeUsers, deactivatedUsers, totalRequisitions, activeRequisitions, draftRequisitions, pendingRequisitions, returnedRequisitions, approvedRequisitions, rejectedRequisitions });
    }

    return NextResponse.json({ message: "No dashboard statistics are configured for this role." }, { status: 403 });
  } catch (error) {
    console.error("Dashboard API error:", error);
    return NextResponse.json({ message: error.message || "Failed to load dashboard statistics." }, { status: 500 });
  }
}
