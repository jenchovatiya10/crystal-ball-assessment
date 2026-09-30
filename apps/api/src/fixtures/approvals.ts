import { ApprovalSchema, type Approval } from "@crystal-ball/shared";

/**
 * Deterministic seeded approvals for Crystal Ball assessment modes.
 * IDs, timestamps, and flag order are fixed — do not randomize.
 */
const RAW_APPROVALS = [
  {
    id: "apr_folder_site_patrol_onboarding",
    title: "Site Patrol Onboarding & Checklists Folder",
    type: "folder",
    submittedAt: "2026-09-20T09:00:00.000Z",
    dueAt: "2026-10-02T17:00:00.000Z",
    flags: ["checklist", "onboarding", "site-patrol"],
  },
  {
    id: "apr_video_level2_drone_patrol_demo",
    title: "Level 2 Drone Patrol Video Demo",
    type: "video",
    submittedAt: "2026-09-22T14:30:00.000Z",
    dueAt: "2026-10-04T17:00:00.000Z",
    flags: ["demo", "drone", "level-2"],
  },
  {
    id: "apr_pdf_safety_equipment_sensor_specs",
    title: "Safety Equipment & Sensor Specs PDF",
    type: "pdf",
    submittedAt: "2026-09-18T11:15:00.000Z",
    dueAt: "2026-09-30T17:00:00.000Z",
    flags: ["safety", "sensors", "specs"],
  },
  {
    id: "apr_image_spatial_zone_camera_map",
    title: "360° Spatial Zone Layout & Camera Map Image",
    type: "image",
    submittedAt: "2026-09-24T08:45:00.000Z",
    dueAt: "2026-10-06T17:00:00.000Z",
    flags: ["spatial", "camera-map", "360"],
  },
] as const;

export const APPROVALS: readonly Approval[] = RAW_APPROVALS.map((item) =>
  ApprovalSchema.parse(item),
);

export const APPROVALS_BY_ID: Readonly<Record<string, Approval>> =
  Object.freeze(
    Object.fromEntries(APPROVALS.map((approval) => [approval.id, approval])),
  );
