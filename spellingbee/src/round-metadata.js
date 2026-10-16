'use strict';
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
function snapshotMetadata({isDaily,isWeekly,dailyPlayed,dailyWord,gameStartTime,statsFinalized}){
 return {roundMetadataVersion:1,roundMode:isDaily?'daily':isWeekly?'weekly':'practice',dailyConsumedDate:dailyPlayed&&validDate(dailyWord?.date)?dailyWord.date:null,jackpotStartedAt:gameStartTime,statsFinalized:!!statsFinalized};
}
function restoreMetadata(saved,currentDate,now=Date.now()){
 const dailyOrigin=validDate(saved.dailyPuzzleDate)?saved.dailyPuzzleDate:null;
 const mode=saved.roundMetadataVersion===1?saved.roundMode:dailyOrigin?'daily':'practice';
 const consumed=saved.roundMetadataVersion===1?saved.dailyConsumedDate:dailyOrigin;
 const opening=[saved.jackpotStartedAt,saved.startTime].find(value=>Number.isFinite(value)&&value>0&&value<=now)??now;
 return {isDaily:mode==='daily'&&!!dailyOrigin,isWeekly:mode==='weekly',dailyPlayed:validDate(consumed)&&consumed===currentDate,gameStartTime:opening,statsFinalized:typeof saved.statsFinalized==='boolean'?saved.statsFinalized:saved.status==='ended'};
}
module.exports={snapshotMetadata,restoreMetadata,validDate};
