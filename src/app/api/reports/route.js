import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import Requisition from "@/models/Requisition";
import { COLLEGES } from "@/constants/colleges";
import { ROLES } from "@/constants/roles";
import { getRequisitionVisibilityQuery, canViewRequisition } from "@/lib/requisitionVisibility";

export const dynamic = "force-dynamic";

function getAuth() {
  const token = cookies().get("token")?.value;
  return token ? verifyToken(token) : null;
}

const collegeNameById = COLLEGES.reduce((acc, college) => {
  acc[college.id] = college.name;
  return acc;
}, {});

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  // Date inputs send YYYY-MM-DD. Validate before constructing a Date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  if (endOfDay) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function idString(value) {
  if (value && typeof value === "object" && value._id) return String(value._id);
  return value == null ? "" : String(value);
}

function unitsFor(record) {
  if (record.isConsolidated && Array.isArray(record.requestingUnits) && record.requestingUnits.length) {
    return record.requestingUnits;
  }
  return [{ collegeId: record.collegeId, facultyId: record.facultyId, department: record.department }];
}

function itemCost(item) {
  const saved = Number(item?.totalCost);
  if (Number.isFinite(saved) && saved >= 0 && saved > 0) return saved;
  const quantity = Number(item?.quantity) || 0;
  const unitCost = Number(item?.procurementUnitCost ?? item?.unitCost ?? item?.requestedUnitCost) || 0;
  return Math.max(0, quantity * unitCost);
}

function totalCost(record) {
  const itemTotal = (record.items || []).reduce((sum, item) => sum + itemCost(item), 0);
  const estimated = Number(record.estimatedCost);
  return itemTotal > 0 ? itemTotal : Number.isFinite(estimated) && estimated > 0 ? estimated : 0;
}

function costForCollege(record, collegeId) {
  const items = Array.isArray(record.items) ? record.items : [];
  const taggedItems = items.filter((item) => item.requestingCollegeId);
  if (taggedItems.length) {
    const amount = taggedItems
      .filter((item) => idString(item.requestingCollegeId) === collegeId)
      .reduce((sum, item) => sum + itemCost(item), 0);
    if (amount > 0 || taggedItems.some((item) => idString(item.requestingCollegeId) === collegeId)) return amount;
  }

  const units = unitsFor(record);
  const distinctCollegeIds = [...new Set(units.map((unit) => idString(unit.collegeId)).filter(Boolean))];
  if (distinctCollegeIds.length <= 1) return totalCost(record);
  return totalCost(record) / distinctCollegeIds.length;
}

function costForDepartment(record, unit, collegeId) {
  const items = Array.isArray(record.items) ? record.items : [];
  const department = unit.department || record.department || "Unspecified";
  const taggedItems = items.filter((item) => item.requestingDepartment || item.requestingCollegeId);
  if (taggedItems.length) {
    const matching = taggedItems.filter((item) => {
      const itemCollege = idString(item.requestingCollegeId);
      const itemDepartment = item.requestingDepartment || department;
      return (!itemCollege || itemCollege === collegeId) && itemDepartment === department;
    });
    if (matching.length) return matching.reduce((sum, item) => sum + itemCost(item), 0);
  }

  const units = unitsFor(record).filter((candidate) => !collegeId || idString(candidate.collegeId) === collegeId);
  const distinctKeys = [...new Set(units.map((candidate) => `${idString(candidate.collegeId)}::${candidate.department || record.department || "Unspecified"}`))];
  return distinctKeys.length > 1 ? totalCost(record) / distinctKeys.length : collegeId ? costForCollege(record, collegeId) : totalCost(record);
}

function addGroup(map, key, amount) {
  const normalizedKey = key || "Unspecified";
  const existing = map.get(normalizedKey) || { _id: normalizedKey, count: 0, totalCost: 0 };
  existing.count += 1;
  existing.totalCost += amount;
  map.set(normalizedKey, existing);
}

function summarize(records, collegeFilter) {
  const byStatus = new Map();
  const byCollege = new Map();
  const byDepartment = new Map();
  const byCategory = new Map();
  const byProcurementStatus = new Map();
  let reportTotalCost = 0;

  for (const record of records) {
    const units = unitsFor(record);
    const recordCost = collegeFilter ? costForCollege(record, collegeFilter) : totalCost(record);
    reportTotalCost += recordCost;
    addGroup(byStatus, record.status || "unknown", recordCost);
    addGroup(byCategory, record.category || "Uncategorized", recordCost);
    addGroup(byProcurementStatus, record.procurementStatus || "not_started", recordCost);

    const collegeUnits = new Map();
    for (const unit of units) {
      const collegeId = idString(unit.collegeId);
      if (!collegeId || (collegeFilter && collegeId !== collegeFilter)) continue;
      if (!collegeUnits.has(collegeId)) collegeUnits.set(collegeId, unit);
    }
    for (const [collegeId] of collegeUnits) {
      addGroup(byCollege, collegeId, collegeFilter ? recordCost : costForCollege(record, collegeId));
    }

    const deptKeys = new Map();
    for (const unit of units) {
      const collegeId = idString(unit.collegeId);
      if (collegeFilter && collegeId !== collegeFilter) continue;
      const department = unit.department || record.department || "Unspecified";
      const key = `${collegeId || "unknown"}::${department}`;
      if (!deptKeys.has(key)) deptKeys.set(key, { label: department, collegeId });
    }
    for (const [key, value] of deptKeys) {
      const matchingUnit = units.find((unit) => idString(unit.collegeId) === value.collegeId && (unit.department || record.department || "Unspecified") === value.label);
      const amount = matchingUnit ? costForDepartment(record, matchingUnit, value.collegeId) : recordCost;
      addGroup(byDepartment, key, amount);
      const entry = byDepartment.get(key);
      entry._id = value.label;
      entry.collegeId = value.collegeId;
    }
  }

  const sortGroups = (map) => [...map.values()].sort((a, b) => b.count - a.count || b.totalCost - a.totalCost);
  return {
    totals: { count: records.length, totalCost: Math.round(reportTotalCost * 100) / 100 },
    byStatus: sortGroups(byStatus),
    byCollege: sortGroups(byCollege).map((entry) => ({
      ...entry,
      name: collegeNameById[entry._id] || entry._id,
    })),
    byDepartment: sortGroups(byDepartment),
    byCategory: sortGroups(byCategory),
    byProcurementStatus: sortGroups(byProcurementStatus),
  };
}

export async function GET(request) {
  try {
    const auth = getAuth();
    if (!auth) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const visibilityQuery = getRequisitionVisibilityQuery(auth);
    if (!visibilityQuery) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const fromValue = searchParams.get("from");
    const toValue = searchParams.get("to");
    const collegeId = searchParams.get("collegeId")?.trim() || "";
    const from = parseDate(fromValue);
    const to = parseDate(toValue, true);

    if (from === undefined || to === undefined) {
      return NextResponse.json({ message: "Invalid date filter. Use YYYY-MM-DD." }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ message: "The start date must be on or before the end date." }, { status: 400 });
    }

    await connectDB();

    const conditions = [visibilityQuery];
    // HODs/requesters report their original records because they do not
    // necessarily have permission to open the consolidated representative.
    // Wider-scope roles count the representative once and omit absorbed sources.
    if (![ROLES.HOD, ROLES.REQUESTER].includes(auth.role)) {
      conditions.push({ consolidatedInto: { $exists: false } });
    }
    const createdAt = {};
    if (from) createdAt.$gte = from;
    if (to) createdAt.$lte = to;
    if (Object.keys(createdAt).length) conditions.push({ createdAt });

    // Fetch only the fields needed for reporting, then apply the same final
    // authorization check used by requisition pages to guard against legacy records.
    const candidates = await Requisition.find({ $and: conditions })
      .select("_id requester status procurementStatus createdAt collegeId facultyId department category estimatedCost items isConsolidated requestingUnits consolidatedBy approvalChain currentStepIndex procurementOfficer procurementAssignedTo procurementAssignedBy")
      .lean();
    let records = candidates.filter((record) => canViewRequisition(auth, record));

    if (collegeId) {
      records = records.filter((record) =>
        unitsFor(record).some((unit) => idString(unit.collegeId) === collegeId) ||
        (record.items || []).some((item) => idString(item.requestingCollegeId) === collegeId)
      );
    }

    return NextResponse.json(summarize(records, collegeId || null));
  } catch (error) {
    console.error("Reports API failed:", error);
    return NextResponse.json({ message: "Unable to generate reports right now." }, { status: 500 });
  }
}
