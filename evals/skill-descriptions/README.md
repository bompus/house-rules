# Skill description selection cases

`cases.json` pairs real task phrases with the target skill and whether that
skill should be selected. Other relevant skills may also be selected. A target
selected on a near-miss still counts as an unnecessary invocation.

Compare current and proposed descriptions in identical isolated catalogs,
including neighboring descriptions and invocation metadata. Run each request
at least three times per wording in independent contexts, and keep the complete
selections. Check positive recall and near-miss selection separately; preserve
explicit-only policies.

These cases cover template-styling cleanup versus general design review, and
performance measurements or saved evidence versus diagnosis, model research,
selection-quality tests and host availability. Catalog selection replies are
a proxy; native skill-call traces and action behavior need their own checks.
