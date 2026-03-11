pub mod ai;
pub mod audiobookshelf;
pub mod immich;
pub mod jellyfin;
pub mod paperless;

pub use ai::AiClassifier;
pub use audiobookshelf::AudiobookshelfClient;
pub use immich::ImmichClient;
pub use jellyfin::JellyfinClient;
pub use paperless::PaperlessClient;
