"""PLT-84 vocabulary v3: consolidate the 367 stage-2 key proposals (owner option 1, via Coach 2026-11-20).

NEW: the new vocabulary entries. type map = values keyed by entry name (rule-specific concepts are entries,
not keys); referenced as '<key>#<entry>'.
PARAMS: parameter values added to existing parametric keys.
MAP: new key -> old keys. An old key maps to '<newkey>#<entry>' for map keys (entry = old name unless SYN
renames it to merge synonyms), else to the plain/param key itself.
"""
NEW = {
 # roots
 "roots.docs": ("path", "Root of authored documentation."),
 "roots.design_system": ("path", "Root(s) of the shared design system (primitives, tokens, components)."),
 "roots.telemetry": ("path", "Root of the telemetry tracking plan and signal definitions."),
 "roots.coordination": ("path", "Root of the durable workflow-coordination records."),
 "roots.conventions": ("path", "Where the stack's convention documents and convention graph live."),
 "roots.generated": ("list", "Generated output trees (documentation, renders, views) that are outputs, never authored inputs."),
 # roles
 "roles.layer_catalog": ("map", "Per-layer and per-side facts: layer responsibilities, layers per side, layers each harness exercises, component-type catalog and weights."),
 "roles.runtime_components": ("map", "The plan-executing runtime components (dispatcher, journey/train/interlocking runners, route resolver, train executor): local names, entry points, locations."),
 "roles.plan_hierarchy": ("map", "Plan decomposition levels, the unit of decomposition and its local names, containment fields."),
 # layout
 "layout.locations": ("map", "Location (path segment, glob or pattern) of an artifact kind not covered by a dedicated layout key."),
 "layout.registries": ("map", "Registry and index files that enumerate artifacts of a kind (decisions, contracts, trains, themes, subjects...)."),
 "layout.schemas": ("map", "Locations of schemas that define artifact formats."),
 "layout.contract_paths": ("map", "Contract tree layout: root, per-layout schema paths (flat, faceted, collection), catalog and contract-test locations."),
 # urn
 "urn.test_kinds": ("map", "Test-identity URN shapes and kind segments per test kind (e2e, train e2e, journey smoke, responsive, telemetry), and harness-code maps."),
 "urn.header": ("map", "Header fields and markers a file carries for traceability (identity, Tested-By, runtime, journey/train references)."),
 "urn.grammar": ("map", "URN and identifier grammar not covered by a per-artifact key: separators, named parts, identity fields, reference shapes."),
 "urn.builder": ("map", "Canonical constructs that build a URN for an artifact kind."),
 # idiom
 "idiom.plan_syntax": ("map", "Constructs of plan artifacts (produce/consume, routes, trains, ownership, status, references, sessions)."),
 "idiom.acceptance_schema": ("map", "The acceptance-artifact schema: precondition fields, trigger shapes, assertion kinds, harness templates and codes, telemetry decision."),
 "idiom.docs_syntax": ("map", "Documentation constructs: identity, status and lifecycle, relationships, internal references, generated regions, decision-record headers."),
 "idiom.convention_graph": ("map", "Convention-graph constructs: node id fields, operative fields, anchors, edge endpoints, rule-binding files."),
 "idiom.routing": ("map", "Composition-root routing constructs: action-to-route maps, route tables, journey maps and registries, start and launch surfaces."),
 "idiom.test_constructs": ("map", "Test-code constructs: test case and context, assertions and matchers, substitutions, phase and RED markers, fixtures, browser measurements."),
 "idiom.responsive": ("map", "Responsive styling: breakpoints, viewports, width conditions and declarations, length units, styling contexts and notations."),
 "idiom.design_system": ("map", "Design-system constructs: token definition and reference, raw colour literals, component exports, barrels, interactive controls, renderers."),
 "idiom.markup": ("map", "Declarative markup constructs beyond the dedicated idiom keys: request and swap constructs, progress signals, event handlers, ids, interpolation."),
 "idiom.telemetry": ("map", "Telemetry constructs: emit calls, event shapes, vendor SDKs, observation tiers and channels."),
 "idiom.logging": ("map", "Logging constructs: logger receivers, structured logger, context shape, ad-hoc print calls, CLI output."),
 "idiom.security": ("map", "Security-relevant constructs: SQL sinks and parameterisation, authorization checks, environment access, error-response payloads."),
 "idiom.module_boundaries": ("map", "Module and runtime boundary constructs: imports, outbound I/O calls, servers, collaborators, composition domains, structural roots."),
 "idiom.dto_shape": ("map", "How a DTO is declared, named and kept pure."),
 "idiom.naming": ("map", "Naming constructs: verb lexicon, name-token separators."),
 "idiom.source_syntax": ("map", "Source-syntax facts used by checks: comment-line kinds, complexity measure, runtime-declaration header and values."),
 "idiom.collaboration": ("map", "Collaboration-toolchain idioms: seat addresses, integration branches, delegation context, model portfolio, file-reading tool."),
 # enforcement
 "enforcement.exceptions": ("map", "Where and how intentional exceptions are declared (allow-lists, coverage exceptions, naming exceptions)."),
 "enforcement.presets": ("map", "Profile presets per kind of work and the location of each profile's registry."),
 # tooling
 "tooling.commands": ("map", "Helper commands of the stack's toolchain (authoring, plan session, generators, renderers, seat lifecycle, cleanup)."),
 "tooling.language_scopes": ("map", "Languages per check scope (scanned code, test files, in-scope files)."),
 "tooling.test_harness": ("map", "The declared test harness, foreign harnesses that must not be used, and runtime families of tests."),
 "tooling.typecheck": ("map", "Typecheck configuration, checker dependencies, no-emit commands, step names and strictness options."),
 "tooling.stack_signals": ("list", "Markers by which a repository or package is recognised as this stack."),
 "tooling.appendix_formats": ("map", "Appendix types, their file formats, and which formats the agent tooling can read."),
}
PARAMS = {
 ("suffix", "file_kind"): ["test", "test_exempt", "contract", "documentation", "rejected_markup", "telemetry_test", "telemetry_signal", "a11y_test", "train", "convention_node", "coordination_record", "declaration", "barrel", "placeholder", "appendix", "agent_instruction"],
 ("urn", "artifact"): ["test", "telemetry", "telemetry_item", "contract", "interlocking", "participant", "artifact"],
}
MAP = {
 "roots.docs": ["roots.docs"],
 "roots.design_system": ["roots.design", "roots.design_system", "layout.design_root", "layout.design_system_root"],
 "roots.telemetry": ["roots.telemetry", "layout.telemetry_signal_tree"],
 "roots.coordination": ["roots.coordination"],
 "roots.conventions": ["roots.conventions"],
 "roots.generated": ["roots.docs_generated", "layout.docs_generated", "layout.render_output"],
 "roles.layer_catalog": ["roles.layer_profiles", "roles.layers_per_side", "roles.harness_layers", "roles.layers.count", "idiom.component_type_catalog", "idiom.component_type_weights"],
 "roles.runtime_components": ["roles.dispatcher.name", "roles.runtime.path", "roles.structural_names", "idiom.interlocking_runner", "idiom.interlocking_runners", "idiom.journey_runner", "idiom.train_runner", "idiom.train_executor", "idiom.journey_executor", "idiom.route_resolver", "idiom.route_control_runner", "idiom.station_master_reference", "idiom.production_runner_references", "idiom.direct_train_execution", "idiom.train_execution_entry", "idiom.train_resolution_entry_point", "idiom.step_sequence_loop", "layout.trains_dir", "layout.train_dir", "layout.orchestrator_dir"],
 "roles.plan_hierarchy": ["roles.plan_artifact.levels", "roles.plan_artifact.granularity_ladder", "roles.plan_artifact.unit_name", "idiom.plan_unit", "idiom.bounded_unit", "idiom.plan_containment"],
 "layout.locations": ["layout.adapter_dir", "layout.adr_file", "layout.appendix_dir", "layout.appendix_storage", "layout.coordination_records", "layout.decision_records", "layout.decisions_dir", "layout.definition_anchor_file", "layout.design_layers", "layout.design_system_layers", "layout.design_token_layer", "layout.design_tokens_layer", "layout.docs_archive", "layout.docs_areas", "layout.docs_index_name", "layout.extension_dir", "layout.feature_test_location", "layout.interlocking_dir", "layout.interlocking_home", "layout.journey_view_dir", "layout.journey_view.index_page", "layout.journey_view.diagram_format", "layout.model_portfolio", "layout.plan_metadata_file", "layout.session_machine", "layout.telemetry_item", "layout.telemetry_signal_dir", "layout.telemetry_manifest_input", "layout.train_document_sidecars", "layout.wagon_entry", "layout.wagon_module"],
 "layout.registries": ["layout.adr_registry", "layout.decision_registry", "layout.contract_registry", "layout.contracts_registry", "layout.convention_graph", "layout.features_manifest", "layout.index_registry", "layout.interlocking_registry", "layout.subject_registry", "layout.theme_registry", "layout.train_registry", "roots.theme_taxonomy", "urn.theme_map"],
 "layout.schemas": ["layout.journey_schema", "layout.plan_schema", "layout.contract_schema_location", "enforcement.schema_location"],
 "layout.contract_paths": ["layout.contracts_dir", "layout.contract_file", "layout.contract_flat", "layout.contract_faceted", "layout.contract_collection", "layout.contract_catalog", "layout.contract_tests", "layout.contract_generic", "layout.artifact_tests_dir", "idiom.contract_path_mapping"],
 "urn.test_kinds": ["urn.e2e_kinds", "urn.e2e_test", "urn.train_e2e_test", "urn.journey_smoke_test", "urn.responsive_test", "urn.telemetry_kinds", "urn.telemetry_test_kind_segments", "urn.harness_code_map"],
 "urn.header": ["urn.header_fields", "urn.journey_markers", "urn.reference.journey", "urn.reference.train"],
 "urn.grammar": ["urn.hierarchy_separator", "urn.variant_separator", "urn.parts.acceptance", "urn.acceptance_id", "urn.identity_keys", "urn.plan_identity_fields", "urn.embedded_acceptance_identity", "urn.legacy_id.acceptance", "urn.name_carriers", "urn.external_dependency", "urn.interface_entry", "urn.train_sequence_artifact", "urn.coverage_list", "urn.commit_receipt", "urn.contract_id", "urn.contract_registry_id", "urn.artifact_name"],
 "urn.builder": ["urn.builder.component", "urn.builder.wagon", "idiom.urn_builder", "idiom.acceptance_urn_derivation"],
 "idiom.plan_syntax": ["idiom.consume_producer_reference", "idiom.contract_reference", "idiom.contract_external_marker", "idiom.contract_identity_field", "idiom.collection_contract", "idiom.external_actor", "idiom.feature_kind_declaration", "idiom.feature_kind_line", "idiom.human_participant", "idiom.plan_docs_declaration", "idiom.plan_intent_sections", "idiom.plan_item_owner", "idiom.plan_lens_ref", "idiom.plan_ownership_declaration", "idiom.plan_produce_declaration", "idiom.plan_variant_selection", "idiom.route_declaration", "idiom.route_space_declaration", "idiom.train_wagon_list", "idiom.declared_train_sequence", "idiom.wagon_draft_status", "idiom.coverage_status_exemption", "idiom.guard_grammar", "idiom.decomposition_reasoning_kinds", "idiom.reference_syntax", "idiom.registry_mirrored_fields", "idiom.plan_spec_promotion", "idiom.plan_session", "idiom.session_gate_error", "idiom.declaration_load", "idiom.cargo_calls"],
 "idiom.acceptance_schema": ["idiom.acceptance_precondition_fields", "idiom.acceptance_when_shapes", "idiom.acceptance_assertion_kinds", "idiom.harness_templates", "idiom.harness_codes", "idiom.telemetry_decision"],
 "idiom.docs_syntax": ["idiom.doc_id_declaration", "urn.doc_id_declaration", "idiom.doc_identity_attributes", "idiom.doc_lifecycle", "idiom.doc_relationship_attribute", "idiom.doc_relationship_attributes", "idiom.doc_status_marker", "idiom.archival_status_marker", "idiom.internal_reference", "idiom.fenced_example_block", "idiom.generated_region", "idiom.generated_region_marker", "idiom.decision_declaration", "idiom.decision_record_declaration", "idiom.decision_record_header"],
 "idiom.convention_graph": ["idiom.convention_node_id_field", "idiom.convention_operative_fields", "idiom.definition_anchor_id", "idiom.relationship_edge_endpoints", "idiom.rule_binding_files", "enforcement.convention_nodes"],
 "idiom.routing": ["idiom.action_route_map", "idiom.journey_map", "idiom.route_map", "idiom.route_table", "idiom.route_train_selection", "idiom.interlocking_route", "idiom.journey_registry", "idiom.journey_entry_binding", "idiom.journey_start_surface", "idiom.launch_surface"],
 "idiom.test_constructs": ["idiom.test_assertion", "idiom.test_case", "idiom.test_context", "idiom.vacuous_matchers", "idiom.rejection_assertion", "idiom.emission_assertion", "idiom.emission_assertions", "idiom.id_reaching_assertions", "idiom.collaborator_substitution", "idiom.forbidden_runner_substitutions", "idiom.temporary_file", "idiom.environment_mutation", "idiom.test_write_scopes", "idiom.red_markers", "idiom.phase_declaration", "idiom.test_phase_declaration", "idiom.telemetry_test", "idiom.visual_spec_markers", "idiom.screenshot_comparison", "idiom.a11y_audit", "idiom.overflow_measure", "idiom.viewport_setting_forms", "idiom.testing_witness"],
 "idiom.responsive": ["idiom.breakpoints", "idiom.breakpoints_declaration", "idiom.breakpoint_matching", "idiom.viewports", "idiom.viewports_declaration", "idiom.responsive_width_condition", "idiom.width_declarations", "idiom.length_unit_base", "idiom.style_kinds", "idiom.styling_contexts", "idiom.style_notations"],
 "idiom.design_system": ["idiom.token_reference", "idiom.token_definition", "idiom.raw_color_literal", "idiom.color_value_contexts", "idiom.declarative_token_form", "idiom.value_control_flow", "idiom.component_export", "idiom.barrel_module", "idiom.interactive_controls", "idiom.rendering_component", "idiom.renderer_imports"],
 "idiom.markup": ["idiom.hypermedia_markup_marker", "idiom.declarative_behaviour_attributes", "idiom.inline_event_handler_form", "idiom.component_event_props", "idiom.endpoint_declarations", "idiom.request_constructs", "idiom.progress_signals", "idiom.oob_swap_construct", "idiom.inband_swap_construct", "idiom.markup_id_binding", "idiom.markup_interpolation"],
 "idiom.telemetry": ["idiom.telemetry_emit_call", "idiom.telemetry_emit_calls", "idiom.telemetry_event_shapes", "idiom.telemetry_vendor_sdks", "idiom.single_truth_tiers", "idiom.observable_channels"],
 "idiom.logging": ["idiom.logger_receivers", "idiom.logging_context_shape", "idiom.structured_logger", "idiom.adhoc_print_calls", "idiom.cli_interface_output"],
 "idiom.security": ["idiom.sql_query_sinks", "idiom.sql_parameterisation", "idiom.authorization_check", "idiom.env_access", "idiom.error_response_payload"],
 "idiom.module_boundaries": ["idiom.bare_http_calls", "idiom.native_server_construct", "idiom.forbidden_server_constructions", "idiom.collaborator_construction", "idiom.collaborator_naming", "idiom.composition_domain", "idiom.internal_import", "idiom.type_only_import", "idiom.structural_roots"],
 "idiom.dto_shape": ["idiom.dto_declaration", "idiom.dto_naming", "idiom.dto_purity"],
 "idiom.naming": ["idiom.naming_verb_lexicon", "idiom.verb_lexicon", "idiom.name_token_separators"],
 "idiom.source_syntax": ["idiom.comment_line_kinds", "idiom.complexity_measure", "idiom.runtime_declaration", "idiom.runtime_values"],
 "idiom.collaboration": ["idiom.seat_address", "idiom.integration_branch", "idiom.project_main_address", "tooling.delegation_context", "idiom.file_read_tool"],
 "enforcement.exceptions": ["enforcement.allowlists", "enforcement.naming_exception_list", "idiom.naming_exception_list", "idiom.coverage_exceptions"],
 "enforcement.presets": ["enforcement.presets", "enforcement.profile_registries"],
 "tooling.commands": ["tooling.author", "tooling.authoring_writer", "tooling.plan_command", "tooling.plan_orchestrator", "tooling.contract_authoring", "tooling.decision_registry_generator", "tooling.docs_generator", "tooling.docs_renderer", "tooling.seat_commands", "tooling.worktree_cleanup", "tooling.workflow_cli"],
 "tooling.language_scopes": ["tooling.scan_languages", "tooling.in_scope_languages", "tooling.test_languages"],
 "tooling.test_harness": ["tooling.test_harness", "tooling.foreign_test_harnesses", "tooling.test_runtime_family"],
 "tooling.typecheck": ["tooling.typecheck.config", "tooling.typecheck.checker_dependencies", "tooling.typecheck.no_emit_commands", "tooling.typecheck.step_names", "idiom.typecheck_strictness"],
 "tooling.stack_signals": ["tooling.stack_signals", "tooling.runtime_config"],
 "tooling.appendix_formats": ["tooling.appendix_readable_formats", "tooling.appendix_type_map", "suffix.appendix_types", "idiom.appendix_types"],
 # parametric keys (existing or extended)
 "suffix.test": ["suffix.test", "suffix.test_files"],
 "suffix.test_exempt": ["suffix.test_exclusion"],
 "suffix.contract": ["suffix.contract", "suffix.contract_schema"],
 "suffix.documentation": ["suffix.documentation"],
 "suffix.rejected_markup": ["suffix.markup_alt"],
 "suffix.telemetry_test": ["suffix.telemetry_test", "suffix.telemetry_test_colocation"],
 "suffix.telemetry_signal": ["suffix.telemetry_signal"],
 "suffix.a11y_test": ["suffix.a11y_test"],
 "suffix.train": ["suffix.train"],
 "suffix.convention_node": ["suffix.convention_node"],
 "suffix.coordination_record": ["suffix.coordination_record"],
 "suffix.declaration": ["suffix.declaration_file"],
 "suffix.barrel": ["suffix.barrel"],
 "suffix.placeholder": ["suffix.placeholder"],
 "suffix.appendix": ["suffix.appendix_pattern"],
 "suffix.agent_instruction": ["suffix.agent_instruction"],
 "urn.test": ["urn.test"],
 "urn.telemetry": ["urn.telemetry"],
 "urn.telemetry_item": ["urn.telemetry_item"],
 "urn.contract": ["urn.contract"],
 "urn.interlocking": ["urn.interlocking"],
 "urn.participant": ["urn.participant"],
 "urn.artifact": ["urn.artifact", "urn.exchanged_artifact", "urn.interface_artifact"],
 "urn.binding.test": ["urn.binding.test", "urn.binding.a11y"],
 "urn.binding.telemetry": ["urn.binding.telemetry", "urn.binding.telemetry_item"],
 "urn.binding.contract": ["urn.binding.contract"],
 "urn.binding.acceptance": ["urn.case_binding.acceptance"],
}
# Synonym merges inside map keys: old key -> entry name (default: old key without its group, dots -> '_').
SYN = {
 "idiom.interlocking_runners": "interlocking_runner", "idiom.emission_assertions": "emission_assertion",
 "idiom.telemetry_emit_calls": "telemetry_emit_call", "idiom.doc_relationship_attributes": "doc_relationship",
 "idiom.doc_relationship_attribute": "doc_relationship", "idiom.breakpoints_declaration": "breakpoints",
 "idiom.viewports_declaration": "viewports", "idiom.test_phase_declaration": "phase_declaration",
 "idiom.generated_region_marker": "generated_region", "idiom.decision_declaration": "decision_record_declaration",
 "idiom.naming_verb_lexicon": "verb_lexicon", "idiom.naming_exception_list": "naming_exceptions",
 "enforcement.naming_exception_list": "naming_exceptions", "urn.doc_id_declaration": "doc_id_declaration",
 "layout.design_tokens_layer": "design_token_layer", "layout.design_system_layers": "design_layers",
 "layout.decisions_dir": "decision_records", "layout.contract_registry": "contracts", "layout.contracts_registry": "contracts",
 "layout.adr_registry": "decisions", "layout.decision_registry": "decisions", "layout.trains_dir": "trains_location",
 "layout.train_dir": "trains_location", "layout.interlocking_home": "interlocking_dir", "urn.contract_registry_id": "contract_id",
 "idiom.feature_kind_line": "feature_kind_declaration", "idiom.urn_builder": "artifact",
 "urn.telemetry_test_kind_segments": "telemetry", "urn.telemetry_kinds": "telemetry",
 "tooling.appendix_type_map": "type_map", "suffix.appendix_types": "types", "idiom.appendix_types": "types",
 "tooling.appendix_readable_formats": "readable_formats",
}
def entry_of(old):
    if old in SYN: return SYN[old]
    return old.split(".", 1)[1].replace(".", "_")
def target(old):
    for new, olds in MAP.items():
        if old in olds:
            return new + "#" + entry_of(old) if NEW.get(new, ("",))[0] == "map" else new
    raise KeyError(old)
