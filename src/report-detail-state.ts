import type {ServiceReport} from "./maintenance";
/** Read-only viewers follow confirmed versions. Staff snapshots stay stable so
 * pending review reason/key cannot be silently reset; stale exports are gated.
 */
export function reportDetailState(rows:ServiceReport[],selected:ServiceReport|null,readonly:boolean) {
  const latest=selected && rows.find(r=>r.id===selected.id && r.jobsiteId===selected.jobsiteId);
  const newer=!!(latest && selected && (latest.version??0)>(selected.version??0));
  const readable=!!(latest && selected && (latest.version??0)>=(selected.version??0));
  return {report:readonly && readable ? latest! : selected,latest:latest??selected,stale:!readonly && newer};
}
