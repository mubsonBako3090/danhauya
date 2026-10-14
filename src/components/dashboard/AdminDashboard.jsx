"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import axios from "axios";
import StatCard from "@/components/ui/StatCard";
import Button from "@/components/ui/Button";
import styles from "./dashboard-grid.module.css";

export default function AdminDashboard({ user }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    axios.get("/api/dashboard").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  const cards = [
    ["Total Users", stats?.totalUsers, "bi-people", "primary", "/users"],
    ["Pending Account Approvals", stats?.pendingUsers, "bi-person-check", "pending", "/users"],
    ["Active Requisitions", stats?.activeRequisitions, "bi-hourglass-split", "approved", "/requisitions"],
    ["Rejected Requisitions", stats?.rejectedRequisitions, "bi-x-circle", "rejected", "/requisitions?status=rejected"],
    ["Audit Events · All Time", stats?.auditEventsAllTime, "bi-activity", "primary", "/audit-trail"],
    ["Approval Decisions · All Time", stats?.approvalEventsAllTime, "bi-check2-square", "approved", "/audit-trail"],
    ["User Activity · All Time", stats?.userEventsAllTime, "bi-person-lines-fill", "pending", "/audit-trail"],
    ["Requisition Activity · All Time", stats?.requisitionEventsAllTime, "bi-file-earmark-text", "draft", "/audit-trail"],
  ];

  return (
    <div className={styles.wrapper}>
      <div>
        <h1 className={styles.heading}>Welcome, {user.fullName.split(" ")[0]}</h1>
        <p className={styles.subheading}>System Administration &amp; Audit Overview</p>
      </div>

      <div className={styles.actions}>
        <Link href="/users">
          <Button><i className="bi bi-people" /> Manage Users</Button>
        </Link>
        <Link href="/audit-trail">
          <Button variant="secondary"><i className="bi bi-shield-check" /> Open Audit Trail</Button>
        </Link>
      </div>

      <div className={styles.statGrid}>
        {cards.map(([label, value, icon, tone, href]) => (
          <Link href={href} key={label} className={styles.cardLink}>
            <StatCard label={label} value={value} icon={icon} tone={tone} />
          </Link>
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>System Overview</h2>
        <p className={styles.subheading}>
          Monitor users, requisition activity, approvals, and the audit record without changing operational workflows.
        </p>
        <div className={styles.actions}>
          <Link href="/users"><Button variant="secondary">Review Users</Button></Link>
          <Link href="/audit-trail"><Button variant="secondary">Review Audit Events</Button></Link>
        </div>
      </div>
    </div>
  );
}
