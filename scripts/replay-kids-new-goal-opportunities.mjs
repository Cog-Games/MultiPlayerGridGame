// Geometry opportunity replay, NOT a simulation of behavior after a changed reveal.
// Usage: node scripts/replay-kids-new-goal-opportunities.mjs input.json output.json
import fs from 'node:fs';
import { NewGoalGenerator as G } from '../client/src/utils/NewGoalGenerator.js';
const [input,output]=process.argv.slice(2);
if(!input || !output) throw new Error('Provide exported generation_replay_input.json and an output path');
const trials=JSON.parse(fs.readFileSync(input)).filter(t=>t.distanceCondition!=='no_new_goal')
  .sort((a,b)=>a.roomId.localeCompare(b.roomId) || a.participantId.localeCompare(b.participantId) || a.trialIndex-b.trialIndex);
// Only tie-breaking is random. Fixed seed keeps this replay reproducible.
let seed=20260904;
Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const rows=[],banks={strict:{},balanced:{}};
for(const t of trials){
  const scope=t.partnerAgentType==='human' ? t.roomId : `${t.roomId}:${t.participantId}`;
  const row={participant:t.participantId,trial:t.trialIndex,condition:t.distanceCondition,
    observedReveal:t.newGoalPresented,observedRound:t.newGoalPresentedTime};
  for(const mode of ['strict','balanced']){
    const key=`${scope}:${t.distanceCondition}`;
    let firstShared=null,result=null,seenShared=false;
    // Do not reuse positions after the original reveal (already affected by it),
    // or after either actor reaches a goal. Both must have a decision opportunity.
    const end=Math.min(t.newGoalPresented ? t.newGoalPresentedTime : Infinity,
      t.player1GoalReachedStep-1,t.player2GoalReachedStep-1);
    for(let k=1;k<=end;k++){
      const g1=t.player1CurrentGoal[k-1],g2=t.player2CurrentGoal[k-1];
      const currentShared=Number.isInteger(g1)&&g1===g2&&g1>=0&&g1<2;
      if(firstShared===null&&currentShared)firstShared=g1;
      const reference=currentShared?g1:firstShared;
      if(reference===null)continue;
      seenShared=true;
      const p1=t.player1Trajectory[k],p2=t.player2Trajectory[k];
      if(!p1||!p2)throw new Error('Missing pre-reveal active-player position');
      const candidate=G.generateNewGoal(p2,p1,t.initialGoalPositions,reference,t.distanceCondition,
        {allowTolerance:mode==='balanced',balance:banks[mode][key]||G.emptyBalance()});
      if(candidate){result={round:k,...candidate};banks[mode][key]=candidate.balanceAfter;break;}
    }
    row[mode]=result;
    row[`${mode}MissingReason`]=result?null:(seenShared?'no_candidate_within_bounds':'no_shared_goal_before_first_arrival');
  }
  rows.push(row);
}
const summary={};
for(const condition of ['all','equal_to_both','closer_to_player1','closer_to_player2']){
  const subset=rows.filter(r=>condition==='all'||r.condition===condition);
  summary[condition]={planned:subset.length,observed:subset.filter(r=>r.observedReveal).length,
    strictOpportunities:subset.filter(r=>r.strict).length,
    balancedOpportunities:subset.filter(r=>r.balanced).length,
    relaxedFirstOpportunities:subset.filter(r=>r.balanced?.generationMode==='bounded-tolerance').length};
}
fs.writeFileSync(output,JSON.stringify({scope:'recorded paths only, before actual reveal and either arrival',summary,banks,rows},null,2));
console.log(JSON.stringify(summary,null,2));
console.log('Remaining missing:',rows.filter(r=>!r.balanced).map(r=>[r.participant,r.trial,r.condition,r.balancedMissingReason]));
