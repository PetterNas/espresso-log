namespace EspressoLog.Data;

// Kept out of Bean so listing beans never loads image bytes.
public class BeanPhoto
{
    public int BeanId { get; set; }
    public byte[] Data { get; set; } = [];
    public string ContentType { get; set; } = "image/jpeg";
    public DateTime UpdatedAt { get; set; }
}
