namespace EspressoLog.Data;

public class Bean
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; }
    public string Name { get; set; } = "";
    public string? Roaster { get; set; }
    public string? Origin { get; set; }
    public string? PurchasedFrom { get; set; }
    public DateOnly? RoastDate { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public decimal? Price { get; set; }
    public double? AmountGrams { get; set; }
    public int? Rating { get; set; }
    public string? Review { get; set; }
    public bool Finished { get; set; }

    public List<Shot> Shots { get; set; } = [];
    public BeanPhoto? Photo { get; set; }
}
