npm warn Unknown project config "electron_mirror". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn Unknown project config "electron_builder_binaries_mirror". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
Unused files (85)
src/main/core/agent/at-commands/types.ts                           
src/main/core/agent/tools/sandbox-exec.ts                          
src/main/services/db/audit-log.ts                                  
src/main/services/skills/index.ts                                  
src/main/services/skills/loader.ts                                 
src/main/services/skills/registry.ts                               
src/main/services/skills/router.ts                                 
src/main/services/skills/types.ts                                  
src/main/services/tutorial/crawler/types.ts                        
src/renderer/src/components/ai/AgentWorkflowPanel.tsx              
src/renderer/src/components/ai/at-commands/AtCommandBadge.tsx      
src/renderer/src/components/ai/at-commands/AtCommandChip.tsx       
src/renderer/src/components/ai/at-commands/AtCommandPicker.tsx     
src/renderer/src/components/ai/at-commands/index.ts                
src/renderer/src/components/ai/at-commands/useAtCommandInjection.ts
src/renderer/src/components/ai/AttentionBubble.tsx                 
src/renderer/src/components/ai/ChatPanel.tsx                       
src/renderer/src/components/ai/ConfidenceBreakdown.tsx             
src/renderer/src/components/ai/CredibilityPanel.tsx                
src/renderer/src/components/ai/DecisionCard.tsx                    
src/renderer/src/components/ai/EvidenceChain.tsx                   
src/renderer/src/components/ai/ExpectedOutput.tsx                  
src/renderer/src/components/ai/McpStatusBar.tsx                    
src/renderer/src/components/ai/PlanBuildButton.tsx                 
src/renderer/src/components/ai/RiskConfirm.tsx                     
src/renderer/src/components/ai/SandboxApprovalDialog.tsx           
src/renderer/src/components/ai/SidecarStatusPanel.tsx              
src/renderer/src/components/ai/SrePipelinePanel.tsx                
src/renderer/src/components/ai/TaskPermissionApprovalDialog.tsx    
src/renderer/src/components/ai/ToolApprovalModal.tsx               
src/renderer/src/components/ai/ToolCallCard.tsx                    
src/renderer/src/components/common/EmptyState.tsx                  
src/renderer/src/components/common/ErrorState.tsx                  
src/renderer/src/components/common/FadeInUp.tsx                    
src/renderer/src/components/common/icons.ts                        
src/renderer/src/components/common/index.ts                        
src/renderer/src/components/common/RiskTag.tsx                     
src/renderer/src/components/common/SectionTitle.tsx                
src/renderer/src/components/common/StaggerList.tsx                 
src/renderer/src/components/common/ToolTag.tsx                     
src/renderer/src/components/deploy/DeployDialog.tsx                
src/renderer/src/components/ds/ds-ui.tsx                           
src/renderer/src/components/history-detail/ActionLog.tsx           
src/renderer/src/components/history-detail/EvidenceTimeline.tsx    
src/renderer/src/components/history-detail/KnowledgeUpdate.tsx     
src/renderer/src/components/history-detail/ResultTable.tsx         
src/renderer/src/components/history-detail/SummaryCard.tsx         
src/renderer/src/components/history/DecisionCard.tsx               
src/renderer/src/components/history/FilterBar.tsx                  
src/renderer/src/components/history/mock-data.ts                   
src/renderer/src/components/history/Pagination.tsx                 
src/renderer/src/components/history/StatCard.tsx                   
src/renderer/src/components/layout/ServerList.tsx                  
src/renderer/src/components/monitor/CorrelationCard.tsx            
src/renderer/src/components/monitor/CpuChart.tsx                   
src/renderer/src/components/monitor/MemoryChart.tsx                
src/renderer/src/components/monitor/MonitorPanel.tsx               
src/renderer/src/components/profiler/ProfilerDialog.tsx            
src/renderer/src/components/settings/index.ts                      
src/renderer/src/components/settings/SettingsSections.tsx          
src/renderer/src/components/terminal/TerminalTabs.tsx              
src/renderer/src/components/trae/Badge.tsx                         
src/renderer/src/components/trae/Card.tsx                          
src/renderer/src/components/trae/ContextMenu.tsx                   
src/renderer/src/components/trae/Dialog.tsx                        
src/renderer/src/components/trae/Dropdown.tsx                      
src/renderer/src/components/trae/icons.tsx                         
src/renderer/src/components/trae/Label.tsx                         
src/renderer/src/components/trae/Progress.tsx                      
src/renderer/src/components/trae/RadioGroup.tsx                    
src/renderer/src/components/trae/Separator.tsx                     
src/renderer/src/components/trae/Skeleton.tsx                      
src/renderer/src/components/trae/Tabs.tsx                          
src/renderer/src/components/trae/Tooltip.tsx                       
src/renderer/src/components/workbench/GlobalSearch.tsx             
src/renderer/src/components/workbench/InlineCompletionProvider.tsx 
src/renderer/src/components/workbench/InlineDiffAdapter.tsx        
src/renderer/src/components/workbench/panels/utils.ts              
src/renderer/src/components/workbench/QuickFileSearch.tsx          
src/renderer/src/components/workbench/SelectionPopover.tsx         
src/renderer/src/components/workbench/TokenCostRow.tsx             
src/renderer/src/pages/__fixtures__/decision-detail-sample.ts      
src/renderer/src/stores/terminal-store.ts                          
src/renderer/src/stores/workbench-store.ts                         
src/renderer/src/utils/evidence-to-input.ts                        
Unused dependencies (14)
@radix-ui/react-context-menu   package.json:46:6
@radix-ui/react-dialog         package.json:47:6
@radix-ui/react-dropdown-menu  package.json:48:6
@radix-ui/react-label          package.json:49:6
@radix-ui/react-progress       package.json:50:6
@radix-ui/react-radio-group    package.json:51:6
@radix-ui/react-separator      package.json:53:6
@radix-ui/react-tabs           package.json:57:6
@radix-ui/react-tooltip        package.json:58:6
@types/dompurify               package.json:60:6
@volcengine/ark-runtime        package.json:61:6
dompurify                      package.json:73:6
electron-log                   package.json:74:6
reactflow                      package.json:84:6
Unused devDependencies (3)
@testing-library/user-event  package.json:103:6
esbuild                      package.json:118:6
tailwindcss                  package.json:123:6
Unlisted binaries (1)
ssh-keygen  src/main/ipc/ssh.ts
Unused exports (261)
LogCommandHandler                              src/main/core/agent/at-commands/index.ts:24:10                           
CmdCommandHandler                              src/main/core/agent/at-commands/index.ts:25:10                           
FileCommandHandler                             src/main/core/agent/at-commands/index.ts:26:10                           
MetricCommandHandler                           src/main/core/agent/at-commands/index.ts:27:10                           
DecisionCommandHandler                         src/main/core/agent/at-commands/index.ts:28:10                           
KbCommandHandler                               src/main/core/agent/at-commands/index.ts:29:10                           
SkillCommandHandler                            src/main/core/agent/at-commands/index.ts:30:10                           
ServerCommandHandler                           src/main/core/agent/at-commands/index.ts:31:10                           
createClaudeSdkTools                 function  src/main/core/agent/claude-sdk/claude-sdk-tools.ts:45:23                 
extractUsage                         function  src/main/core/agent/claude-sdk/claude-sdk-wrapper.ts:146:17              
mapStopReason                        function  src/main/core/agent/claude-sdk/claude-sdk-wrapper.ts:171:17              
mapErrorSubtype                      function  src/main/core/agent/claude-sdk/claude-sdk-wrapper.ts:203:17              
createClaudeSdkTools                           src/main/core/agent/claude-sdk/index.ts:27:3                             
createLinuxOpsMcpServer                        src/main/core/agent/claude-sdk/index.ts:28:3                             
TDSF_LINUX_OPS_SERVER_NAME                     src/main/core/agent/claude-sdk/index.ts:29:3                             
convertClaudeResultToChatResult                src/main/core/agent/claude-sdk/index.ts:34:3                             
extractAssistantText                           src/main/core/agent/claude-sdk/index.ts:35:3                             
extractPartialText                             src/main/core/agent/claude-sdk/index.ts:36:3                             
extractUsage                                   src/main/core/agent/claude-sdk/index.ts:37:3                             
mapStopReason                                  src/main/core/agent/claude-sdk/index.ts:38:3                             
mapErrorSubtype                                src/main/core/agent/claude-sdk/index.ts:39:3                             
isResultMessage                                src/main/core/agent/claude-sdk/index.ts:40:3                             
isAssistantMessage                             src/main/core/agent/claude-sdk/index.ts:41:3                             
isPartialAssistantMessage                      src/main/core/agent/claude-sdk/index.ts:42:3                             
DEFAULT_AUDIT_DIRNAME                          src/main/core/agent/credibility/audit/exporter.ts:45:14                  
AUDIT_REPORT_SCHEMA_VERSION                    src/main/core/agent/credibility/audit/exporter.ts:376:10                 
AUDIT_GENERATOR_VERSION                        src/main/core/agent/credibility/audit/exporter.ts:376:39                 
CALIBRATION_STATE_VERSION                      src/main/core/agent/credibility/calibration/calibration-tuner.ts:42:14   
DEFAULT_OPTIMAL_T                              src/main/core/agent/credibility/calibration/calibration-tuner.ts:45:14   
DEFAULT_STATE_FILEPATH                         src/main/core/agent/credibility/calibration/calibration-tuner.ts:48:14   
RETUNE_THRESHOLD                               src/main/core/agent/credibility/calibration/calibration-tuner.ts:51:14   
resetCalibrationTuner                function  src/main/core/agent/credibility/calibration/calibration-tuner.ts:422:17  
DEFAULT_NUM_BUCKETS                            src/main/core/agent/credibility/calibration/ece.ts:37:14                 
MIN_SAMPLES                                    src/main/core/agent/credibility/calibration/ece.ts:40:14                 
computeGlobalEce                     function  src/main/core/agent/credibility/calibration/ece.ts:142:17                
DEFAULT_T_MIN                                  src/main/core/agent/credibility/calibration/temperature-scaling.ts:45:14 
DEFAULT_T_MAX                                  src/main/core/agent/credibility/calibration/temperature-scaling.ts:48:14 
DEFAULT_T_STEPS                                src/main/core/agent/credibility/calibration/temperature-scaling.ts:51:14 
DEFAULT_MIN_SAMPLES                            src/main/core/agent/credibility/calibration/temperature-scaling.ts:54:14 
computeNll                           function  src/main/core/agent/credibility/calibration/temperature-scaling.ts:200:17
AI_PARAM_SOURCE_ID                             src/main/core/agent/credibility/mass-functions/ai-param-source.ts:55:14  
AI_PARAM_SOURCE_NAME                           src/main/core/agent/credibility/mass-functions/ai-param-source.ts:58:14  
AI_PARAM_SOURCE_PRIOR                          src/main/core/agent/credibility/mass-functions/ai-param-source.ts:61:14  
BEST_PRACTICE_SOURCE_ID                        鈥ain/core/agent/credibility/mass-functions/best-practice-source.ts:30:14
BEST_PRACTICE_SOURCE_NAME                      鈥ain/core/agent/credibility/mass-functions/best-practice-source.ts:33:14
BEST_PRACTICE_SOURCE_PRIOR                     鈥ain/core/agent/credibility/mass-functions/best-practice-source.ts:36:14
HISTORY_SOURCE_ID                              src/main/core/agent/credibility/mass-functions/history-source.ts:27:14   
HISTORY_SOURCE_NAME                            src/main/core/agent/credibility/mass-functions/history-source.ts:30:14   
HISTORY_SOURCE_PRIOR                           src/main/core/agent/credibility/mass-functions/history-source.ts:33:14   
HUMAN_SOURCE_ID                                src/main/core/agent/credibility/mass-functions/human-source.ts:29:14     
HUMAN_SOURCE_NAME                              src/main/core/agent/credibility/mass-functions/human-source.ts:32:14     
HUMAN_SOURCE_PRIOR                             src/main/core/agent/credibility/mass-functions/human-source.ts:35:14     
KB_SOURCE_ID                                   src/main/core/agent/credibility/mass-functions/kb-source.ts:29:14        
KB_SOURCE_NAME                                 src/main/core/agent/credibility/mass-functions/kb-source.ts:32:14        
KB_SOURCE_PRIOR                                src/main/core/agent/credibility/mass-functions/kb-source.ts:35:14        
LOG_SOURCE_ID                                  src/main/core/agent/credibility/mass-functions/log-source.ts:27:14       
LOG_SOURCE_NAME                                src/main/core/agent/credibility/mass-functions/log-source.ts:30:14       
LOG_SOURCE_PRIOR                               src/main/core/agent/credibility/mass-functions/log-source.ts:33:14       
generateFormulaDisplay               function  src/main/core/agent/credibility/visualizer.ts:214:17                     
generateSummary                      function  src/main/core/agent/credibility/visualizer.ts:245:17                     
runOpsAgent                          function  src/main/core/agent/mastra/ops-agent.ts:138:23                           
MCP_STATE_DESCRIPTION                          src/main/core/agent/mcp-lifecycle.ts:44:14                               
MCP_STATE_SEVERITY                             src/main/core/agent/mcp-lifecycle.ts:53:14                               
deleteProvider                       function  src/main/core/agent/providers/provider-registry.ts:187:17                
listTemplateSummaries                function  src/main/core/agent/providers/provider-templates.ts:239:17               
containsSensitivePath                function  src/main/core/agent/providers/redact.ts:144:17                           
listRedactRules                      function  src/main/core/agent/providers/redact.ts:153:17                           
persist                              function  src/main/core/agent/providers/token-stats.ts:92:17                       
loadPersisted                        function  src/main/core/agent/providers/token-stats.ts:115:17                      
resetSessionRegistry                 function  src/main/core/agent/session-registry.ts:358:17                           
BaseSubagent                                   src/main/core/agent/subagents/index.ts:11:10                             
createSubagentTask                             src/main/core/agent/subagents/index.ts:11:24                             
CodingSubagent                                 src/main/core/agent/subagents/index.ts:20:10                             
ThinkingSubagent                               src/main/core/agent/subagents/index.ts:21:10                             
RunningSubagent                                src/main/core/agent/subagents/index.ts:22:10                             
SearchSubagent                                 src/main/core/agent/subagents/index.ts:23:10                             
SkillSubagent                                  src/main/core/agent/subagents/index.ts:24:10                             
MethodologySubagent                            src/main/core/agent/subagents/index.ts:25:10                             
HistorySubagent                                src/main/core/agent/subagents/index.ts:26:10                             
KnowledgeSubagent                              src/main/core/agent/subagents/index.ts:27:10                             
ExploreSubagent                                src/main/core/agent/subagents/index.ts:30:10                             
dispatchSubagents                              src/main/core/agent/subagents/index.ts:34:10                             
loadCustomAgent                                src/main/core/agent/subagents/index.ts:42:10                             
loadCustomAgents                               src/main/core/agent/subagents/index.ts:42:27                             
resetLoopEngineeringSubagent         function  src/main/core/agent/subagents/loop-engineering-subagent.ts:725:17        
stepValidateInput                              src/main/core/agent/subagents/task-protocol-steps.ts:26:3                
stepCheckPermission                            src/main/core/agent/subagents/task-protocol-steps.ts:27:3                
stepLoadSubagentConfig                         src/main/core/agent/subagents/task-protocol-steps.ts:28:3                
stepDerivePermissions                          src/main/core/agent/subagents/task-protocol-steps.ts:29:3                
stepPrepareContext                             src/main/core/agent/subagents/task-protocol-steps.ts:30:3                
stepSelectProvider                             src/main/core/agent/subagents/task-protocol-steps.ts:34:3                
stepSelectMode                                 src/main/core/agent/subagents/task-protocol-steps.ts:35:3                
stepBuildPrompt                                src/main/core/agent/subagents/task-protocol-steps.ts:36:3                
stepInvokeSubagent                             src/main/core/agent/subagents/task-protocol-steps.ts:37:3                
stepStreamOutput                               src/main/core/agent/subagents/task-protocol-steps.ts:38:3                
stepCollectUsage                               src/main/core/agent/subagents/task-protocol-steps.ts:42:3                
stepValidateOutput                             src/main/core/agent/subagents/task-protocol-steps.ts:43:3                
TASK_PROTOCOL_STEPS                            src/main/core/agent/subagents/task-protocol.ts:48:10                     
stepValidateInput                              src/main/core/agent/subagents/task-protocol.ts:52:3                      
stepCheckPermission                            src/main/core/agent/subagents/task-protocol.ts:53:3                      
stepLoadSubagentConfig                         src/main/core/agent/subagents/task-protocol.ts:54:3                      
stepDerivePermissions                          src/main/core/agent/subagents/task-protocol.ts:55:3                      
stepPrepareContext                             src/main/core/agent/subagents/task-protocol.ts:56:3                      
stepSelectProvider                             src/main/core/agent/subagents/task-protocol.ts:57:3                      
stepSelectMode                                 src/main/core/agent/subagents/task-protocol.ts:58:3                      
stepBuildPrompt                                src/main/core/agent/subagents/task-protocol.ts:59:3                      
stepInvokeSubagent                             src/main/core/agent/subagents/task-protocol.ts:60:3                      
stepStreamOutput                               src/main/core/agent/subagents/task-protocol.ts:61:3                      
stepCollectUsage                               src/main/core/agent/subagents/task-protocol.ts:62:3                      
stepValidateOutput                             src/main/core/agent/subagents/task-protocol.ts:63:3                      
stepCleanup                                    src/main/core/agent/subagents/task-protocol.ts:64:3                      
stepReturnResult                               src/main/core/agent/subagents/task-protocol.ts:65:3                      
STEP_FUNCTIONS                                 src/main/core/agent/subagents/task-protocol.ts:66:3                      
extractWord                          function  src/main/core/risk-engine-ast-utils.ts:103:17                            
shouldAutoApprove                    function  src/main/core/risk-engine.ts:409:17                                      
cancelAllWorkflows                   function  src/main/ipc/agent.ts:321:17                                             
getRequiredNumber                    function  src/main/ipc/credibility-helpers.ts:33:17                                
getOptionalNumber                    function  src/main/ipc/credibility-helpers.ts:44:17                                
getRequiredBoolean                   function  src/main/ipc/credibility-helpers.ts:56:17                                
getOptionalNumberArray               function  src/main/ipc/credibility-helpers.ts:73:17                                
createMassFunctionFromInput          function  src/main/ipc/credibility-helpers.ts:106:17                               
SANDBOX_APPROVAL_CHANNEL                       src/main/ipc/sandbox-approval.ts:50:14                                   
SANDBOX_APPROVAL_TIMEOUT_MS                    src/main/ipc/sandbox-approval.ts:52:14                                   
assessCommandRiskRegex               function  src/main/ipc/sandbox-approval.ts:122:17                                  
safeSend                             function  src/main/ipc/sandbox-approval.ts:295:17                                  
resetSandboxInstances                function  src/main/ipc/sandbox-config.ts:139:17                                    
resetSandboxInstances                          src/main/ipc/sandbox.ts:62:33                                            
setupSchedulerStatusPush             function  src/main/ipc/scheduler.ts:221:17                                         
TASK_PERMISSION_APPROVAL_CHANNEL               src/main/ipc/task-permission-approval.ts:36:14                           
TASK_PERMISSION_APPROVE_INVOKE                 src/main/ipc/task-permission-approval.ts:38:14                           
TASK_PERMISSION_APPROVAL_TIMEOUT_MS            src/main/ipc/task-permission-approval.ts:40:14                           
pendingTaskPermissionApprovals                 src/main/ipc/task-permission-approval.ts:59:14                           
escapeShellValue                     function  src/main/services/deploy/plan-builder.ts:25:17                           
validateVariable                     function  src/main/services/deploy/plan-builder.ts:42:17                           
interpolateCommand                   function  src/main/services/deploy/plan-builder.ts:92:17                           
BUILTIN_RULES                                  src/main/services/diagnostics/log-analyzer.ts:31:14                      
buildDecisionPrompt                  function  src/main/services/llm/prompt-templates.ts:107:17                         
buildKnowledgeMatchPrompt            function  src/main/services/llm/prompt-templates.ts:148:17                         
buildChatPrompt                      function  src/main/services/llm/prompt-templates.ts:188:17                         
buildCommandResultPrompt             function  src/main/services/llm/prompt-templates.ts:258:17                         
buildKnowledgeContextPrompt          function  src/main/services/llm/prompt-templates.ts:295:17                         
TOOL_METAS                                     src/main/services/llm/tools/registry.ts:23:14                            
Logger                               class     src/main/services/log/logger.ts:125:14                                   
CREDIBILITY_TOOL_NAMES                         src/main/services/mcp/tools/registry-credibility.ts:204:14               
CREDIBILITY_TOOL_METAS                         src/main/services/mcp/tools/registry-credibility.ts:210:14               
KNOWLEDGE_TOOL_NAMES                           src/main/services/mcp/tools/registry-knowledge.ts:338:14                 
KNOWLEDGE_TOOL_METAS                           src/main/services/mcp/tools/registry-knowledge.ts:341:14                 
LOG_TOOL_NAMES                                 src/main/services/mcp/tools/registry-log.ts:277:14                       
LOG_TOOL_METAS                                 src/main/services/mcp/tools/registry-log.ts:280:14                       
MONITOR_TOOL_NAMES                             src/main/services/mcp/tools/registry-monitor.ts:249:14                   
MONITOR_TOOL_METAS                             src/main/services/mcp/tools/registry-monitor.ts:256:14                   
SANDBOX_TOOL_NAMES                             src/main/services/mcp/tools/registry-sandbox.ts:194:14                   
SANDBOX_TOOL_METAS                             src/main/services/mcp/tools/registry-sandbox.ts:201:14                   
requireSshConnected                  function  src/main/services/mcp/tools/registry-ssh.ts:241:17                       
SSH_TOOL_NAMES                                 src/main/services/mcp/tools/registry-ssh.ts:252:14                       
SSH_TOOL_METAS                                 src/main/services/mcp/tools/registry-ssh.ts:261:14                       
withStreamTrace                      function  src/main/services/observability/langfuse-trace.ts:61:24                  
markdownToPdfBuffer                  function  src/main/services/profiler/pdf-exporter.ts:415:23                        
defaultOpenHandsRunner                         src/main/services/sandbox/openhands-runner.ts:254:14                     
VSCODE_NAME                                    src/main/services/sandbox/types.ts:51:14                                 
WORKER_1_NAME                                  src/main/services/sandbox/types.ts:52:14                                 
WORKER_2_NAME                                  src/main/services/sandbox/types.ts:53:14                                 
CronParseError                       class     src/main/services/scheduler/cron-parser.ts:33:14                         
parseCronField                       function  src/main/services/scheduler/cron-parser.ts:137:17                        
parseCron                            function  src/main/services/scheduler/cron-parser.ts:237:17                        
runDailyDecisionArchive              function  src/main/services/scheduler/daily-decision-archive.ts:340:23             
createDailyDecisionArchiveTask       function  src/main/services/scheduler/daily-decision-archive.ts:457:17             
runDailyHealthCheck                  function  src/main/services/scheduler/daily-health-check.ts:148:23                 
DefaultRuleAnalyzer                  class     src/main/services/scheduler/daily-health-check.ts:313:14                 
SshConnectionManagerAdapter          class     src/main/services/scheduler/daily-health-check.ts:445:14                 
resetScheduler                       function  src/main/services/scheduler/scheduler.ts:392:17                          
getISOWeekNumber                     function  src/main/services/scheduler/weekly-ops-report.ts:108:17                  
getLastWeekRange                     function  src/main/services/scheduler/weekly-ops-report.ts:157:17                  
generateImprovementSuggestions       function  src/main/services/scheduler/weekly-ops-report.ts:195:17                  
generateWeeklyReportMarkdown         function  src/main/services/scheduler/weekly-ops-report.ts:251:17                  
executeWeeklyOpsReport               function  src/main/services/scheduler/weekly-ops-report.ts:304:23                  
createWeeklyOpsReportTask            function  src/main/services/scheduler/weekly-ops-report.ts:454:17                  
resolveKnownHostsPath                function  src/main/services/ssh/known-hosts.ts:115:17                              
checkKnownHosts                      function  src/main/services/ssh/known-hosts.ts:319:23                              
appendKnownHost                      function  src/main/services/ssh/known-hosts.ts:380:23                              
removeKnownHost                      function  src/main/services/ssh/known-hosts.ts:411:23                              
replaceKnownHost                     function  src/main/services/ssh/known-hosts.ts:465:23                              
buildUnknownHostPrompt               function  src/main/services/ssh/known-hosts.ts:487:17                              
buildHostKeyChangedPrompt            function  src/main/services/ssh/known-hosts.ts:513:17                              
MONITOR_DATA_EVENT                             src/main/services/ssh/monitor.ts:31:14                                   
MONITOR_SYSTEM_INFO_EVENT                      src/main/services/ssh/monitor.ts:34:14                                   
getDiskInfo                          function  src/main/services/tutorial/crawler/disk-budget.ts:256:23                 
inferLicenseUrl                      function  src/main/services/tutorial/crawler/html-to-tutorial.ts:44:17             
DEFAULT_USER_AGENT                             src/main/services/tutorial/crawler/polite-fetch.ts:25:14                 
politeFetchStream                    function  src/main/services/tutorial/crawler/polite-fetch.ts:300:23                
scoreLength                          function  src/main/services/tutorial/crawler/quality-filter.ts:82:17               
scoreCommands                        function  src/main/services/tutorial/crawler/quality-filter.ts:94:17               
scoreHeadings                        function  src/main/services/tutorial/crawler/quality-filter.ts:109:17              
scoreLinks                           function  src/main/services/tutorial/crawler/quality-filter.ts:126:17              
scoreDedup                           function  src/main/services/tutorial/crawler/quality-filter.ts:139:17              
scoreEntry                           function  src/main/services/tutorial/crawler/quality-filter.ts:168:17              
formatScoreBreakdown                 function  src/main/services/tutorial/crawler/quality-filter.ts:256:17              
TUTORIAL_CRAWL_PROGRESS_CHANNEL                src/main/services/tutorial/crawler/tutorial-crawler-service.ts:39:14     
TUTORIAL_CRAWL_DONE_CHANNEL                    src/main/services/tutorial/crawler/tutorial-crawler-service.ts:41:14     
CATEGORY_DEPENDENCIES                          src/main/services/tutorial/path-recommender.ts:42:14                     
CATEGORY_DEFAULT_DIFFICULTY                    src/main/services/tutorial/path-recommender.ts:68:14                     
COMMAND_ASSOCIATION_RULES                      src/main/services/tutorial/path-recommender.ts:101:14                    
formatPathDuration                   function  src/main/services/tutorial/path-recommender.ts:600:17                    
getCategoryColor                     function  src/main/services/tutorial/path-recommender.ts:611:17                    
TUTORIAL_SEED_ENTRIES                          src/main/services/tutorial/seeds.ts:20:14                                
getMainWindow                        function  src/main/windows/main-window.ts:97:17                                    
TOC_ITEMS                                      src/renderer/src/components/knowledge-detail/v1/index.ts:18:3            
META_ROWS                                      src/renderer/src/components/knowledge-detail/v1/index.ts:20:3            
RELATED_ITEMS                                  src/renderer/src/components/knowledge-detail/v1/index.ts:21:3            
LOG_TERMINAL_BG                                src/renderer/src/components/logs/v1/logs-data.ts:108:14                  
ipcLogEntryToLogEntry                function  src/renderer/src/components/logs/v1/logs-data.ts:186:17                  
sampleKpiStats                                 src/renderer/src/components/monitor/mock-data.ts:76:14                   
sampleAlerts                                   src/renderer/src/components/monitor/mock-data.ts:120:14                  
default                              function  src/renderer/src/components/settings/ssh/DefaultsCard.tsx:131:16         
default                              function  src/renderer/src/components/settings/ssh/KeyCard.tsx:115:16              
default                              function  src/renderer/src/components/settings/ssh/SecurityCard.tsx:93:16          
default                              function  src/renderer/src/components/settings/ssh/ServerCard.tsx:228:16           
default                              function  src/renderer/src/components/settings/TokenUsageChart.tsx:304:16          
fetchRemoteDict                      function  src/renderer/src/components/terminal/translator.ts:136:23                
default                                        src/renderer/src/components/terminal/translator.ts:460:16                
buttonVariants                                 src/renderer/src/components/trae/Button.tsx:67:18                        
SelectGroup                                    src/renderer/src/components/trae/Select.tsx:148:3                        
SelectLabel                                    src/renderer/src/components/trae/Select.tsx:152:3                        
SelectSeparator                                src/renderer/src/components/trae/Select.tsx:154:3                        
SelectScrollUpButton                           src/renderer/src/components/trae/Select.tsx:155:3                        
SelectScrollDownButton                         src/renderer/src/components/trae/Select.tsx:156:3                        
TUTORIAL_PROGRESS_KEY                          src/renderer/src/components/tutorial/types.ts:101:14                     
mapDifficulty                        function  src/renderer/src/components/tutorial/types.ts:191:17                     
pickIcon                             function  src/renderer/src/components/tutorial/types.ts:201:17                     
formatDuration                       function  src/renderer/src/components/tutorial/types.ts:216:17                     
computeFeaturedProgress              function  src/renderer/src/components/tutorial/types.ts:247:17                     
SOURCE_LABELS                                  src/renderer/src/components/tutorial/v1/hybrid-search-types.ts:166:14    
SOURCE_COLORS                                  src/renderer/src/components/tutorial/v1/hybrid-search-types.ts:178:14    
FileTreeContextMenu                            src/renderer/src/components/workbench/FileTreeContextMenu.tsx:84:14      
default                              function  src/renderer/src/components/workbench/StatusBar.tsx:196:16               
TraeLayoutIcon                                 src/renderer/src/components/workbench/TraeIcons.tsx:93:14                
TraeTerminalIcon                               src/renderer/src/components/workbench/TraeIcons.tsx:102:14               
TraeSparklesIcon                               src/renderer/src/components/workbench/TraeIcons.tsx:110:14               
TraeServerIcon                                 src/renderer/src/components/workbench/TraeIcons.tsx:117:14               
default                              function  src/renderer/src/components/workbench/usePaorLoop.ts:182:16              
default                              function  src/renderer/src/components/workbench/WorkbenchTitlebar.tsx:379:16       
sampleProcesses                                src/renderer/src/pages/__fixtures__/monitor-sample.ts:153:14             
sampleCpuAreaPath                              src/renderer/src/pages/__fixtures__/monitor-sample.ts:164:14             
sampleMemLines                                 src/renderer/src/pages/__fixtures__/monitor-sample.ts:168:14             
sampleDiskIo                                   src/renderer/src/pages/__fixtures__/monitor-sample.ts:175:14             
sampleNetFlow                                  src/renderer/src/pages/__fixtures__/monitor-sample.ts:203:14             
APP_BUILD_LABEL                                src/renderer/src/pages/about-settings.constants.ts:59:14                 
default                              function  src/renderer/src/pages/BootPage.tsx:466:16                               
default                              variable  src/renderer/src/stores/editor-store.ts:84:16                            
parseListSegments                    function  src/renderer/src/utils/decision-mappers.ts:86:17                         
getElectronAPI                       function  src/renderer/src/utils/electron-api.ts:9:17                              
newCorrelationId                     function  src/renderer/src/utils/logger.ts:49:17                                   
AT_COMMAND_LABELS                              src/shared/at-command-types.ts:195:14                                    
AT_COMMAND_ICONS                               src/shared/at-command-types.ts:211:14                                    
AT_COMMAND_LIST                                src/shared/at-command-types.ts:227:14                                    
DEPLOY_RISK_LABELS                             src/shared/deploy-types.ts:15:14                                         
DEPLOY_RISK_COLORS                             src/shared/deploy-types.ts:24:14                                         
DEPLOY_RISK_ICON_NAMES                         src/shared/deploy-types.ts:37:14                                         
TOOL_RISK_LABELS                               src/shared/llm-tool-types.ts:16:14                                       
TOOL_RISK_COLORS                               src/shared/llm-tool-types.ts:25:14                                       
TUTORIAL_DIFFICULTY_COLORS                     src/shared/tutorial-types.ts:146:14                                      
Unused exported types (168)
LogCommandSource               type       src/main/core/agent/at-commands/log-command.ts:135:13                      
ClaudeSdkInternalChatParams    type       src/main/core/agent/claude-sdk/index.ts:20:15                              
ClaudeSdkChatParams            type       src/main/core/agent/claude-sdk/index.ts:23:15                              
ConvertClaudeResultOptions     type       src/main/core/agent/claude-sdk/index.ts:44:15                              
AuditFormat                    type       src/main/core/agent/credibility/audit/report-builder.ts:582:15             
AuditDecisionAction            interface  src/main/core/agent/credibility/audit/types.ts:277:18                      
CalibrationChannelMap          interface  src/main/core/agent/credibility/calibration/types.ts:178:18                
TraceSource                    type       src/main/core/agent/credibility/mass-functions/cot-trace-collector.ts:50:13
CotTraceAnalysis               type       src/main/core/agent/credibility/mass-functions/cot-trace-signal.ts:26:37   
ExpectationViolationType       type       src/main/core/agent/expectation-monitor.ts:32:57                           
ModelRoleMapping               type       src/main/core/agent/providers/types.ts:33:3                                
DispatchStep                   type       src/main/core/agent/subagents/dispatcher.ts:55:13                          
ReflectResult                  interface  src/main/core/agent/subagents/dispatcher.ts:278:18                         
ApprovalResult                 interface  src/main/core/agent/subagents/dispatcher.ts:345:18                         
ExploreTaskInput               interface  src/main/core/agent/subagents/explore-subagent.ts:45:18                    
ExploreResultOutput            interface  src/main/core/agent/subagents/explore-subagent.ts:59:18                    
SubagentTask                   type       src/main/core/agent/subagents/index.ts:14:3                                
SubagentResult                 type       src/main/core/agent/subagents/index.ts:15:3                                
SubagentRegistry               type       src/main/core/agent/subagents/index.ts:16:3                                
ExploreTaskInput               type       src/main/core/agent/subagents/index.ts:31:15                               
ExploreResultOutput            type       src/main/core/agent/subagents/index.ts:31:33                               
DispatchStep                   type       src/main/core/agent/subagents/index.ts:36:3                                
DispatchContext                type       src/main/core/agent/subagents/index.ts:37:3                                
DispatchResult                 type       src/main/core/agent/subagents/index.ts:38:3                                
CustomAgentConfig              type       src/main/core/agent/subagents/index.ts:43:15                               
Subagent                       type       src/main/core/agent/subagents/task-protocol-types.ts:32:3                  
SubagentRegistry               type       src/main/core/agent/subagents/task-protocol-types.ts:33:3                  
TaskProtocolStep               type       src/main/core/agent/subagents/task-protocol.ts:39:3                        
StepResult                     type       src/main/core/agent/subagents/task-protocol.ts:40:3                        
StepFunction                   type       src/main/core/agent/subagents/task-protocol.ts:42:3                        
SubagentMeta                   type       src/main/core/agent/subagents/task-protocol.ts:43:3                        
DerivedPermissions             type       src/main/core/agent/subagents/task-protocol.ts:44:3                        
StepUsage                      type       src/main/core/agent/subagents/task-protocol.ts:45:3                        
ProviderModelInstance          type       src/main/core/agent/subagents/task-protocol.ts:46:3                        
ChatParams                     interface  src/main/core/agent/supervisor.ts:76:18                                    
ChatResult                     type       src/main/core/agent/supervisor.ts:102:15                                   
PaorPhase                      type       src/main/core/agent/supervisor.ts:107:13                                   
PaorStepResult                 interface  src/main/core/agent/supervisor.ts:112:18                                   
PlanObject                     interface  src/main/core/agent/supervisor.ts:126:18                                   
ActResult                      interface  src/main/core/agent/supervisor.ts:140:18                                   
ObserveResult                  interface  src/main/core/agent/supervisor.ts:154:18                                   
ReflectResult                  interface  src/main/core/agent/supervisor.ts:166:18                                   
PaorIteration                  interface  src/main/core/agent/supervisor.ts:178:18                                   
PaorLoopResult                 interface  src/main/core/agent/supervisor.ts:196:18                                   
PaorLoopOptions                interface  src/main/core/agent/supervisor.ts:214:18                                   
CommandRiskLevel               type       src/main/core/risk-engine-ast.ts:63:15                                     
ApprovalReason                 type       src/main/core/risk-engine-ast.ts:63:55                                     
PermissionMode                 type       src/main/core/risk-engine.ts:33:13                                         
AdaptersStatus                 interface  src/main/core/sidecar/sidecar-manager.ts:45:18                             
ToolCallResponse               interface  src/main/core/sidecar/sidecar-manager.ts:101:18                            
AppUpdateInfo                  interface  src/main/ipc/app-update.ts:49:18                                           
AppUpdateError                 interface  src/main/ipc/app-update.ts:67:18                                           
AppInfo                        interface  src/main/ipc/app-update.ts:124:18                                          
BootLoadingStage               interface  src/main/ipc/boot.ts:25:18                                                 
FileChangedPayload             type       src/main/ipc/file-watcher.ts:47:15                                         
FileChangeEvent                type       src/main/ipc/file-watcher.ts:47:35                                         
ImageUploadResult              interface  src/main/ipc/fs-upload.ts:28:18                                            
ImageUploadError               interface  src/main/ipc/fs-upload.ts:44:18                                            
SandboxApprovalRequest         interface  src/main/ipc/sandbox-approval.ts:58:18                                     
PersistedSandboxConfig         interface  src/main/ipc/sandbox-config.ts:31:18                                       
SandboxInfo                    type       src/main/ipc/sandbox-config.ts:208:15                                      
SandboxApprovalRequest         type       src/main/ipc/sandbox.ts:64:15                                              
SftpSearchFileEntry            interface  src/main/ipc/sftp-search.ts:33:18                                          
SftpGrepMatch                  interface  src/main/ipc/sftp-search.ts:45:18                                          
TaskPermissionMode             type       src/main/ipc/task-permission-approval.ts:49:13                             
PendingTaskPermissionApproval  interface  src/main/ipc/task-permission-approval.ts:52:18                             
RiskLevel                      type       src/main/services/llm/tools/profiler-run.ts:207:15                         
LogCategory                    type       src/main/services/log/logger.ts:41:13                                      
LogEntry                       interface  src/main/services/log/logger.ts:56:18                                      
McpPromptArgument              interface  src/main/services/mcp/prompts.ts:33:18                                     
McpToolResult                  type       src/main/services/mcp/tools/registry-knowledge.ts:349:15                   
McpToolResult                  type       src/main/services/mcp/tools/registry-log.ts:287:15                         
McpToolResult                  type       src/main/services/mcp/tools/registry-monitor.ts:263:15                     
McpToolResult                  type       src/main/services/mcp/tools/registry-sandbox.ts:208:15                     
McpToolResult                  type       src/main/services/mcp/tools/registry-ssh.ts:270:15                         
McpToolMeta                    interface  src/main/services/mcp/tools/registry.ts:32:18                              
LangfuseConfig                 type       src/main/services/observability/langfuse.ts:16:15                          
SpanOptions                    interface  src/main/services/observability/langfuse.ts:31:18                          
ProfilerError                  interface  src/main/services/profiler/types.ts:47:18                                  
SandboxStatus                  type       src/main/services/sandbox/types.ts:26:13                                   
SecretNamesResponse            interface  src/main/services/sandbox/types.ts:111:18                                  
CronField                      type       src/main/services/scheduler/cron-parser.ts:26:13                           
ParsedCron                     interface  src/main/services/scheduler/cron-parser.ts:74:18                           
ArchiveParams                  interface  src/main/services/scheduler/daily-decision-archive.ts:183:18               
ServerMetrics                  interface  src/main/services/scheduler/daily-health-check.ts:27:18                    
AlertSeverity                  type       src/main/services/scheduler/daily-health-check.ts:43:13                    
AlertCategory                  type       src/main/services/scheduler/daily-health-check.ts:44:13                    
HealthAlert                    interface  src/main/services/scheduler/daily-health-check.ts:47:18                    
ServerCheckResult              interface  src/main/services/scheduler/daily-health-check.ts:63:18                    
ServerFailure                  interface  src/main/services/scheduler/daily-health-check.ts:72:18                    
HealthCheckDetails             interface  src/main/services/scheduler/daily-health-check.ts:79:18                    
SshExecutor                    interface  src/main/services/scheduler/daily-health-check.ts:94:18                    
RuleAnalyzer                   interface  src/main/services/scheduler/daily-health-check.ts:104:18                   
HealthCheckParams              interface  src/main/services/scheduler/daily-health-check.ts:109:18                   
DailyDecisionTrend             interface  src/main/services/scheduler/weekly-ops-report.ts:23:18                     
WeeklyReportData               interface  src/main/services/scheduler/weekly-ops-report.ts:46:18                     
WeeklyReportParams             interface  src/main/services/scheduler/weekly-ops-report.ts:76:18                     
FileChangeEvent                type       src/main/services/ssh/file-watcher.ts:27:13                                
CheckpointStatus               type       src/main/services/tutorial/crawler/checkpoint-service.ts:36:13             
QualityBreakdown               interface  src/main/services/tutorial/crawler/quality-filter.ts:26:18                 
QualityScore                   interface  src/main/services/tutorial/crawler/quality-filter.ts:40:18                 
CmdSegment                     interface  src/renderer/src/components/decision/ExecutionResult.tsx:31:18             
TocItem                        type       src/renderer/src/components/knowledge-detail/v1/index.ts:12:3              
DiagnoseStep                   type       src/renderer/src/components/knowledge-detail/v1/index.ts:13:3              
RelatedItem                    type       src/renderer/src/components/knowledge-detail/v1/index.ts:14:3              
MetaRow                        type       src/renderer/src/components/knowledge-detail/v1/index.ts:15:3              
LogSourceGroup                 type       src/renderer/src/components/logs/v1/logs-data.ts:29:13                     
SelectionInfo                  interface  src/renderer/src/components/terminal/selection-manager.ts:26:18            
TerminalSearchBarProps         interface  src/renderer/src/components/terminal/TerminalSearchBar.tsx:16:18           
DictCategory                   type       src/renderer/src/components/terminal/translator.ts:29:13                   
PartOfSpeech                   type       src/renderer/src/components/terminal/translator.ts:37:13                   
DifficultyLevel                type       src/renderer/src/components/terminal/translator.ts:40:13                   
TranslateStrategy              type       src/renderer/src/components/terminal/translator.ts:89:13                   
ButtonProps                    interface  src/renderer/src/components/trae/Button.tsx:50:18                          
EmptyProps                     interface  src/renderer/src/components/trae/Empty.tsx:12:18                           
InputProps                     type       src/renderer/src/components/trae/Input.tsx:14:13                           
LearningPathStep               interface  src/renderer/src/components/tutorial/types.ts:40:18                        
AIPanelProps                   interface  src/renderer/src/components/workbench/AIPanel.tsx:44:18                    
AIPanelHeaderProps             interface  src/renderer/src/components/workbench/AIPanelHeader.tsx:6:18               
ChmodDialogProps               interface  src/renderer/src/components/workbench/ChmodDialog.tsx:10:18                
ImageAttachment                interface  src/renderer/src/components/workbench/Composer.tsx:22:18                   
ComposerProps                  interface  src/renderer/src/components/workbench/Composer.tsx:34:18                   
ContextBadgeProps              interface  src/renderer/src/components/workbench/ContextBadge.tsx:5:18                
EditorAreaProps                interface  src/renderer/src/components/workbench/EditorArea.tsx:79:18                 
FileChangeNoticeProps          interface  src/renderer/src/components/workbench/FileChangeNotice.tsx:10:18           
FileTreeProps                  interface  src/renderer/src/components/workbench/FileTree.tsx:59:18                   
FileTreeContextMenuProps       interface  src/renderer/src/components/workbench/FileTreeContextMenu.tsx:35:18        
MessageListProps               interface  src/renderer/src/components/workbench/MessageList.tsx:15:18                
MonacoEditorProps              interface  src/renderer/src/components/workbench/MonacoEditor.tsx:31:18               
RenameDialogProps              interface  src/renderer/src/components/workbench/RenameDialog.tsx:7:18                
LlmHypothesis                  interface  src/renderer/src/components/workbench/useLoopEngineering.ts:44:18          
AgentWorkflowState             interface  src/renderer/src/components/workbench/useLoopEngineering.ts:61:18          
DecisionCard                   interface  src/renderer/src/components/workbench/useLoopEngineering.ts:72:18          
LoopPhase                      type       src/renderer/src/components/workbench/useLoopEngineering.ts:93:13          
CursorPosition                 interface  src/renderer/src/stores/editor-store.ts:20:18                              
SelectionType                  type       src/renderer/src/stores/editor-store.ts:28:13                              
EditorSelection                interface  src/renderer/src/stores/editor-store.ts:31:18                              
ListCmdSegment                 type       src/renderer/src/utils/decision-mappers.ts:32:13                           
LogLevel                       type       src/renderer/src/utils/logger.ts:20:13                                     
LogCategory                    type       src/renderer/src/utils/logger.ts:23:13                                     
RendererLogPayload             interface  src/renderer/src/utils/logger.ts:39:18                                     
ModelRoleMapping               type       src/shared/agent-types.ts:97:13                                            
CredibilitySourceId            type       src/shared/agent-types.ts:447:13                                           
FusionStepData                 interface  src/shared/agent-types.ts:511:18                                           
DagNodeType                    type       src/shared/agent-types.ts:561:13                                           
AtCommandPayload               type       src/shared/at-command-types.ts:88:13                                       
CrawlerSourceKind              type       src/shared/crawler-types.ts:26:13                                          
SourceToggleConfig             interface  src/shared/crawler-types.ts:129:18                                         
DeployRiskLevel                type       src/shared/deploy-types.ts:12:13                                           
DeployPlanStatus               type       src/shared/deploy-types.ts:131:13                                          
ToolCallRequest                interface  src/shared/llm-tool-types.ts:66:18                                         
SshAuthType                    type       src/shared/models.ts:11:13                                                 
SshHostKeyType                 type       src/shared/models.ts:59:13                                                 
SshHostKeyStatus               type       src/shared/models.ts:80:13                                                 
IpcChannelMap                  interface  src/shared/models.ts:624:18                                                
McpLifecycleState              type       src/shared/models.ts:728:13                                                
RiskItem                       interface  src/shared/models.ts:867:18                                                
ProfilerItem                   interface  src/shared/models.ts:877:18                                                
ProfilerError                  interface  src/shared/models.ts:890:18                                                
ProfilerResult                 interface  src/shared/models.ts:899:18                                                
LogLevel                       type       src/shared/models.ts:929:13                                                
LogEntry                       interface  src/shared/models.ts:932:18                                                
PaorPlanObject                 interface  src/shared/paor-types.ts:18:18                                             
PaorActResult                  interface  src/shared/paor-types.ts:30:18                                             
PaorObserveResult              interface  src/shared/paor-types.ts:42:18                                             
PaorReflectResult              interface  src/shared/paor-types.ts:52:18                                             
TutorialSource                 interface  src/shared/tutorial-types.ts:40:18                                         
TutorialListItem               interface  src/shared/tutorial-types.ts:100:18                                        
Duplicate exports (13)
DefaultsCard|default         src/renderer/src/components/settings/ssh/DefaultsCard.tsx    
KeyCard|default              src/renderer/src/components/settings/ssh/KeyCard.tsx         
SecurityCard|default         src/renderer/src/components/settings/ssh/SecurityCard.tsx    
ServerCard|default           src/renderer/src/components/settings/ssh/ServerCard.tsx      
TokenUsageChart|default      src/renderer/src/components/settings/TokenUsageChart.tsx     
FileTreeContextMenu|default  src/renderer/src/components/workbench/FileTreeContextMenu.tsx
StatusBar|default            src/renderer/src/components/workbench/StatusBar.tsx          
usePaorLoop|default          src/renderer/src/components/workbench/usePaorLoop.ts         
WorkbenchTitlebar|default    src/renderer/src/components/workbench/WorkbenchTitlebar.tsx  
BootPage|default             src/renderer/src/pages/BootPage.tsx                          
SshSettings|default          src/renderer/src/pages/SshSettings.tsx                       
WorkbenchPage|default        src/renderer/src/pages/WorkbenchPage.tsx                     
useEditorStore|default       src/renderer/src/stores/editor-store.ts                      
Configuration hints (9)
src/**/*.d.ts                knip.json  Remove from ignore                                           
src/**/*.test.ts             knip.json  Remove from ignore                                           
src/**/*.spec.ts             knip.json  Remove from ignore                                           
tests/**                     knip.json  Remove from ignore                                           
electron-rebuild             knip.json  Remove from ignoreBinaries                                   
src/main/index.ts            knip.json  Remove redundant entry pattern                               
src/preload/index.ts         knip.json  Remove redundant entry pattern                               
src/renderer/src/main.tsx    knip.json  Remove redundant entry pattern                               
.css                         knip.json  Compiled extension excluded by project (imports not followed)
