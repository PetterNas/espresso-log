namespace EspressoLog.Data;

public class Shot
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public double GrindSetting { get; set; }
    public double DoseGrams { get; set; }
    public int TimeSeconds { get; set; }
    public int BeanId { get; set; }
    public Bean Bean { get; set; } = null!;
    public double? YieldGrams { get; set; }
    public int? Rating { get; set; }
    public string? Notes { get; set; }
    // Taste tags from ShotTags.All, stored as a JSON array.
    public string[] Tags { get; set; } = [];
    // The recipe to come back to for this bag; at most one per bean.
    public bool Best { get; set; }
}

public static class ShotTags
{
    public static readonly string[] All = ["sour", "bitter", "balanced", "sweet", "watery", "syrupy", "channeling"];
}
