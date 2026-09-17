//! Everything about running the Salesforce CLI: finding it, running it with
//! cancellation and timeouts, reading its JSON, and refusing commands that
//! should not run from the app.

pub(crate) mod discover;
pub(crate) mod json;
pub(crate) mod policy;
pub(crate) mod runner;
