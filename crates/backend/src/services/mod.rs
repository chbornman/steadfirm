pub mod ai;
pub mod audiobookshelf;
pub mod ffprobe;
pub mod immich;
pub mod jellyfin;
pub mod kavita;
pub mod paperless;

pub use ai::AiClassifier;
pub use audiobookshelf::AudiobookshelfClient;
pub use immich::ImmichClient;
pub use jellyfin::JellyfinClient;
pub use kavita::KavitaClient;
pub use paperless::PaperlessClient;
