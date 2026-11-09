import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { Location, Role, ScheduleView, Servant } from "../../../types";
import { today, fmtDate, errorText, dayNameForTemplate } from "../../../shared/formatters";
import { ROLES } from "../constants";
import { validateScheduleAssignment } from "../services/assignmentValidation";
import { buildWeekendScheduleRows } from "../services/weekendGeneration";
import { archiveScheduleServiceTemplate, createScheduleLocation, deleteLocationSchedules, deleteScheduleById, saveBulkScheduleAssignments, saveScheduleWithAssignments, updateSchedulePublication, upsertGeneratedSchedules, upsertScheduleServiceTemplate } from "../services/schedulePersistence";

type ScheduleModalMode = "schedule" | "person" | null;
type AskAction = (title: string, message: string, confirmLabel?: string, danger?: boolean) => Promise<boolean>;
type AskText = (title: string, message: string, inputLabel: string, requiredText?: string, defaultValue?: string) => Promise<string | null>;

type ScheduleActionsInput = {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  schedules: ScheduleView[];
  locations: Location[];
  servants: Servant[];
  availability: any[];
  servingPreferences: any[];
  templates: any[];
  editing: ScheduleView | null;
  askAction: AskAction;
  askText: AskText;
  loadData: () => Promise<void>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setScheduleError: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<ScheduleModalMode>>;
  setEditing: Dispatch<SetStateAction<ScheduleView | null>>;
};

export function useScheduleActions({
  client, isAdmin, schedules, locations, servants, availability,
  servingPreferences, templates, editing, askAction, askText,
  loadData, setLoading, setMessage, setScheduleError, setModal, setEditing
}: ScheduleActionsInput) {
  async function saveSchedule(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!client||!isAdmin)return;
    setScheduleError("");
    const fd=new FormData(e.currentTarget);
    const payload={service_date:String(fd.get("service_date")),location_id:String(fd.get("location_id")),service_name:String(fd.get("service_name")),start_time:String(fd.get("start_time")),end_time:String(fd.get("end_time"))};
    const selected:Record<Role,string>={FOH:String(fd.get("FOH")||""),Monitor:String(fd.get("Monitor")||""),Assistant:String(fd.get("Assistant")||"")};
    const chosen=Object.entries(selected).filter(([,id])=>id).map(([role,id])=>({role,id}));
    const validation=validateScheduleAssignment({
      selected:chosen,
      serviceDate:payload.service_date,
      locationId:payload.location_id,
      serviceName:payload.service_name,
      startTime:payload.start_time,
      endTime:payload.end_time,
      schedules,
      availability,
      preferences:servingPreferences,
      editingScheduleId:editing?.id
    });
    if(validation.duplicateServantId){setScheduleError("This servant is selected for more than one role in this service. Please choose a different servant.");return;}
    if(validation.blockedServantIds.length){
      const names=validation.blockedServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant");
      setScheduleError(`Serving eligibility restriction: ${names.join(", ")} cannot serve in this time window, location or service based on their saved preferences. Review Availability → Serving preferences.`);
      return;
    }
    const conflicts=validation.crossChurchConflicts;
    if(conflicts.length){const names=conflicts.map(c=>`${servants.find(p=>p.id===c.servantId)?.full_name??"A servant"} (${c.schedule.location_name} · ${c.schedule.service_name})`);setScheduleError(`Cannot save this schedule. ${names.join(", ")} ${conflicts.length===1?"is":"are"} already assigned at another church location on ${fmtDate(payload.service_date)}. A servant can only serve at one church location per day.`);return;}
    if(validation.overlappingConflicts.length){setScheduleError(`Cannot save this schedule. ${validation.overlappingConflicts.map(c=>servants.find(p=>p.id===c.servantId)?.full_name??"A servant").join(", ")} ${validation.overlappingConflicts.length===1?"has":"have"} an overlapping service at this location.`);return;}
    if(validation.unavailableServantIds.length){setScheduleError(`Cannot assign this schedule. ${validation.unavailableServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant").join(", ")} marked unavailable on ${fmtDate(payload.service_date)}.`);return;}
    if(validation.preferNotServantIds.length&&!await askAction("Availability preference",`${validation.preferNotServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant").join(", ")} marked “Prefer not to serve” on this date. Do you want to continue with this manual assignment?`,"Assign anyway",true))return;
    if(validation.highWorkload.length&&!await askAction("High workload warning",`${validation.highWorkload.map(item=>`${servants.find(p=>p.id===item.servantId)?.full_name??"Servant"} (${item.days} days in the previous 30 days)`).join(", ")} already have a high serving frequency. Continue with this manual assignment?`,"Assign anyway",true))return;
    setLoading(true);setMessage("");
    try {
      const {error}=await saveScheduleWithAssignments(client,{
        scheduleId:editing?.id??null,
        service:payload,
        assignments:ROLES.filter(role=>selected[role]).map(role=>({role,servant_id:selected[role]}))
      });
      if(error)throw error;
      setScheduleError("");setModal(null);setEditing(null);await loadData();
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }

  async function generateWeekend(date:string,weeks=1,templateIds:string[]=[],mode:"add"|"replace"="add") {
    if(!client||!isAdmin)return;
    if(mode==="replace"){
      setScheduleError("Replacing existing service times is temporarily disabled because direct replacement could bypass assignment validation and servant reconfirmation. Use Edit service for existing slots; Add missing only remains available.");
      return;
    }
    const generation=buildWeekendScheduleRows({startDate:date,weeks,templateIds,templates});
    if(!generation.ok){
      if(generation.reason==="choose_saturday"){setMessage("Choose a Saturday to generate the weekend.");return;}
      if(generation.reason==="select_template"){setMessage("Select at least one service template to generate.");return;}
      if(generation.reason==="no_weekend_services"){setScheduleError("The selected templates do not include Saturday or Sunday services.");return;}
      setScheduleError("Choose a valid Saturday and a positive number of weekends.");
      return;
    }
    setLoading(true);setMessage("");setScheduleError("");
    try {
      const {error}=await upsertGeneratedSchedules(client,generation.rows,mode);
      if(error)throw error;
      await loadData();setMessage(`${generation.weekendCount} weekend(s) generated using ${generation.selectedTemplateCount} selected template(s). Existing matching slots were left unchanged. New slots are drafts; assign servants and publish when ready.`);
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }

  async function deleteSchedule(s:ScheduleView){
    if(!client||!isAdmin||!await askAction("Delete service",`Delete ${s.service_name} on ${fmtDate(s.service_date)}? This permanently removes its assignments and any serving-request records linked to this service.`,"Delete service",true))return;
    const {error}=await deleteScheduleById(client,s.id);
    if(error)setMessage(errorText(error));else await loadData();
  }

  async function publishSchedule(s:ScheduleView){
    if(!client||!isAdmin)return;
    const nextStatus=s.status==="published"?"draft":"published";
    if(nextStatus==="published"){
      const missing=["FOH","Monitor"].filter(role=>!s.assignments.some(a=>a.role===role&&a.servant_id));
      if(missing.length&&!await askAction("Incomplete service",`${s.service_name} is missing ${missing.join(" and ")}. Publish anyway?`,"Publish anyway",true))return;
    }
    const {error}=await updateSchedulePublication(client,{locationId:null,scheduleIds:[s.id],status:nextStatus});
    if(error){setMessage(errorText(error));return;}
    setMessage(nextStatus==="published"?"Schedule published. Affected servants receive one grouped notification.":"Schedule moved back to draft.");
    await loadData();
  }

  async function bulkSetLocationStatus(locationId:string,status:"published"|"draft"){
    if(!client||!isAdmin||!locationId)return;
    const allChurches=locationId==="__all_churches__";
    const location=locations.find(l=>l.id===locationId);
    const scopeName=allChurches?"all church locations":location?.name??"this church";
    const action=status==="published"?"publish":"unpublish";
    if(status==="published"){
      const candidates=schedules.filter(s=>(allChurches||s.location_id===locationId)&&s.service_date>=today());
      const missing=candidates.filter(s=>!["FOH","Monitor"].every(role=>s.assignments.some(a=>a.role===role&&a.servant_id)));
      const unavailable=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&availability.some(v=>v.servant_id===a.servant_id&&v.service_date===s.service_date&&v.status==="unavailable")).map(a=>`${a.servant_name} · ${s.location_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      const conflicts=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&schedules.some(other=>other.id!==s.id&&other.service_date===s.service_date&&other.location_id!==s.location_id&&other.assignments.some(x=>x.servant_id===a.servant_id))).map(a=>`${a.servant_name} · ${s.location_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      if(missing.length||unavailable.length||conflicts.length){
        const report=[missing.length?`${missing.length} service(s) missing FOH or Monitor`:null,unavailable.length?`Unavailable servants: ${unavailable.join("; ")}`:null,conflicts.length?`Cross-church conflicts: ${conflicts.join("; ")}`:null].filter(Boolean).join("\n");
        if(!await askAction("Scheduling validation warning",`There are issues across ${scopeName}:\n${report}\n\nDo you want to publish anyway?`,"Publish anyway",true))return;
      }
    }
    const confirmationDetail=allChurches
      ? `${action==="publish"?"Publish":"Unpublish"} all service schedules across ${locations.length} church locations? Servants will receive one grouped notification per account.`
      : `${action==="publish"?"Publish":"Unpublish"} all schedules for ${scopeName}?`;
    if(!await askAction(`${action==="publish"?"Publish":"Unpublish"} all schedules?`,confirmationDetail,action==="publish"?"Publish all":"Unpublish all",action!=="publish"))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const {error}=await updateSchedulePublication(client,{locationId:allChurches?null:locationId,scheduleIds:null,status});
      if(error)throw error;
      await loadData();
      setMessage(`All schedules across ${scopeName} have been ${status==="published"?"published":"unpublished"}. Each affected servant receives one grouped notification.`);
    }catch(e){setMessage(`Bulk ${action} failed: ${errorText(e)}`);}
    finally{setLoading(false);}
  }

  async function applyBulkAssignments(rows:any[]){
    if(!client||!isAdmin)return false;
    setLoading(true);setMessage("");
    try{
      const {data,error}=await saveBulkScheduleAssignments(client,rows);
      if(error){
        const detail=errorText(error);
        if(/admin_bulk_assignments_grouped|schema cache|function .*not found|PGRST202|42883|23505|duplicate key|unique constraint.*assignments/i.test(detail)){
          throw new Error(`The bulk-assignment database function may be missing or outdated. Run supabase/migrations_20261115_bulk_assignment_commit_fix.sql in Supabase SQL Editor, then retry. Details: ${detail}`);
        }
        throw new Error(detail);
      }
      await loadData();
      const changed=typeof data==="number"?data:Number(data??0);
      setMessage(changed>0?`${changed} assignment change(s) saved. Affected servants receive one consolidated notification.`:"Assignments are already up to date. To change a service's publication status, use its Publish/Unpublish action.");
      return true;
    }catch(e){setMessage(`Bulk assignment failed: ${errorText(e)}`);return false;}
    finally{setLoading(false);}
  }

  async function deleteAllLocationSchedules(locationId:string){
    if(!client||!isAdmin||!locationId)return;
    const allChurches=locationId==="__all_churches__";
    const targetLocations=allChurches?locations:[locations.find(l=>l.id===locationId)].filter(Boolean) as Location[];
    if(!targetLocations.length){setMessage("No church locations are available to delete.");return;}
    const targetIds=targetLocations.map(l=>l.id);
    const targetNames=targetLocations.map(l=>l.name);
    const targetSchedules=schedules.filter(s=>targetIds.includes(s.location_id));
    const scopeName=allChurches?`ALL ${targetLocations.length} church locations (${targetNames.join(", ")})`:targetNames[0];
    if(!targetSchedules.length){setMessage(`There are no schedules to delete for ${scopeName}.`);return;}
    const confirmation=await askText(
      "Confirm permanent deletion",
      `This will permanently delete ALL ${targetSchedules.length} schedules, their assignments, and any serving-request records linked to those services for ${scopeName}. This cannot be undone.`,
      'Type exactly: I do understand',
      "I do understand"
    );
    if(confirmation!=="I do understand"){
      if(confirmation!==null)setMessage("Delete all cancelled: confirmation text did not match.");
      return;
    }
    if(!await askAction(
      "Final deletion confirmation",
      `Permanently delete all ${targetSchedules.length} schedules and assignments for ${scopeName}? This cannot be undone.`,
      "Delete permanently",
      true
    ))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const result=await deleteLocationSchedules(client,targetIds,allChurches);
      if(result.error)throw result.error;
      await loadData();
      setMessage(`Deleted ${targetSchedules.length} schedules and their assignments for ${scopeName}.`);
    }catch(e){setMessage(`Delete all failed: ${errorText(e)}`);}
    finally{setLoading(false);}
  }

  async function addLocation(){
    if(!client||!isAdmin)return;
    const name=await askText("Add church location","Enter the name of the new church location.","Church name");if(!name?.trim())return;
    const {error}=await createScheduleLocation(client,name.trim());
    if(error)setMessage(errorText(error));else {setMessage("Church location added.");await loadData();}
  }

  async function addRecurringTemplate(){
    if(!client||!isAdmin)return;
    const locationName=await askText("Add recurring service","Enter the exact church location name. Available: "+locations.map(l=>l.name).join(", "),"Church location");if(!locationName)return;
    const location=locations.find(l=>l.name.toLowerCase()===locationName.trim().toLowerCase());if(!location){setMessage("Location not found. Add the church first.");return;}
    const day=await askText("Choose service day","Enter 6 for Saturday or 0 for Sunday.","Day of week",undefined,"0");if(day!=="0"&&day!=="6"){setMessage("Recurring templates currently support Saturday (6) and Sunday (0). Add weekday specials as individual services.");return;}
    const service_name=await askText("Service name","Enter the recurring service name.","Service name");if(!service_name?.trim())return;
    const start_time=await askText("Start time","Enter the start time in HH:MM format.","Start time",undefined,"09:00");if(!start_time)return;
    const end_time=await askText("End time","Enter the end time in HH:MM format.","End time",undefined,"11:00");if(!end_time)return;
    const {error}=await upsertScheduleServiceTemplate(client,{location_id:location.id,day_of_week:Number(day),service_name:service_name.trim(),start_time,end_time,active:true});
    if(error)setMessage(errorText(error));else {setMessage("Recurring service template saved.");await loadData();}
  }

  async function addServiceTemplate(locationId: string, day: number, name: string, start: string, end: string) {
    if (!client || !isAdmin) throw new Error("Only an administrator with an active session can save service templates.");
    if (!locationId || !name.trim() || !Number.isInteger(day) || ![0, 6].includes(day) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end) {
      throw new Error("Check the church, service day, name and time range before saving.");
    }
    const { error } = await upsertScheduleServiceTemplate(client, {
      location_id: locationId,
      day_of_week: day,
      service_name: name,
      start_time: start,
      end_time: end,
      active: true
    });
    if (error) throw error;
    await loadData();
    setMessage(`${name} template saved. Select it above to generate future weekends.`);
  }

  async function archiveServiceTemplate(template: any) {
    if (!client || !isAdmin) return;
    const confirmed = await askAction(
      "Remove service template",
      `Remove ${template.service_name} (${dayNameForTemplate(template.day_of_week)}) from future recurring generation? Existing schedules already generated from this template will not be deleted.`,
      "Remove template",
      true
    );
    if (!confirmed) return;
    const { error } = await archiveScheduleServiceTemplate(client, template.id);
    if (error) {
      setMessage(errorText(error));
      return;
    }
    await loadData();
    setMessage(`${template.service_name} was removed from active templates. Existing schedules were preserved.`);
  }

  return {
    saveSchedule, generateWeekend, deleteSchedule, publishSchedule,
    bulkSetLocationStatus, applyBulkAssignments, deleteAllLocationSchedules,
    addLocation, addRecurringTemplate, addServiceTemplate, archiveServiceTemplate
  };
}
