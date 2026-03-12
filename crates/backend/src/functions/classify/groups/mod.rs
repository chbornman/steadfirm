//! Group detectors — one per service that has groupable content.
//!
//! Each detector scans classification results for files belonging to its
//! service and groups them by folder structure, series, album, etc.

pub mod audiobooks;
pub mod movies;
pub mod music;
pub mod reading;
pub mod tv_shows;
