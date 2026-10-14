"use client";

import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import SelectField from "@/components/forms/SelectField";
import { formatDateTime } from "@/utils/formatDate";
import styles from "./page.module.css";

const ACTION_OPTIONS = [
  "login",
  "user.self_register",
  "user.register_admin",
  "user.invite",
  "user.approve",
  "user.edit",
  "user.deactivate",
  "user.reactivate",
  "user.password_reset",
  "requisition.draft_create",
  "requisition.draft_update",
  "requisition.submit",
  "requisition.comment",
  "requisition.approve",
  "requisition.return",
  "requisition.reject",
];

const ENTITY_OPTIONS = ["User", "Requisition", "Approval"];

export default function AuditTrailPage() {
  const [filters, setFilters] = useState({ action: "", entityType: "" });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.action) params.action = filters.action;
      if (filters.entityType) params.entityType = filters.entityType;
      params.page = page;
      params.limit = 50;
      const { data } = await axios.get("/api/audit-trail", { params });
      setLogs(data.logs || []);
      setPagination(data.pagination || { page, limit: 50, total: (data.logs || []).length, totalPages: 1 });
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load audit trail.");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const updateFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className={styles.wrapper}>
      <h1 className={styles.heading}>Audit Trail</h1>
      <p className={styles.subheading}>All-time system activity for administrators. Records are shown newest first; use the filters and page controls to investigate older user, requisition, and approval events.</p>

      <div className={styles.filters}>
        <SelectField
          id="action"
          label="Action"
          value={filters.action}
          onChange={(e) => updateFilter("action", e.target.value)}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="entityType"
          label="Entity"
          value={filters.entityType}
          onChange={(e) => updateFilter("entityType", e.target.value)}
        >
          <option value="">All entities</option>
          {ENTITY_OPTIONS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </SelectField>
      </div>

      <p className={styles.hint}>
        {pagination.total.toLocaleString()} matching audit record{pagination.total === 1 ? "" : "s"} across all available time.
      </p>

      {loading ? (
        <p className={styles.hint}>Loading…</p>
      ) : logs.length === 0 ? (
        <p className={styles.hint}>No log entries match these filters.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id}>
                  <td className="mono">{formatDateTime(log.createdAt)}</td>
                  <td>{log.actor?.fullName || "System"}</td>
                  <td>
                    <code className={styles.actionCode}>{log.action}</code>
                  </td>
                  <td>{log.entityType || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && pagination.total > 0 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className={styles.pageInfo}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
            disabled={page >= pagination.totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
