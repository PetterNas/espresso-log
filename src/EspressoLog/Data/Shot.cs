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
}
