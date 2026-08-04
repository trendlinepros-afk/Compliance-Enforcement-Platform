using System.Text;
using CepAgent.Parsers;
using Xunit;

namespace CepAgent.Tests;

public class SecEditTests
{
    private const string Sample = @"[Unicode]
Unicode=yes
[System Access]
MinimumPasswordLength = 14
NewAdministratorName = ""SecAdmin""
[Privilege Rights]
SeNetworkLogonRight = *S-1-5-32-544,*S-1-5-11
SeTcbPrivilege =
[Registry Values]
MACHINE\System\CurrentControlSet\Control\Lsa\LmCompatibilityLevel=4,5
MACHINE\System\CurrentControlSet\Control\Lsa\RestrictRemoteSAM=1,""O:BAG:BAD:(A;;RC;;;BA)""
MACHINE\System\CurrentControlSet\Services\LanmanServer\Parameters\NullSessionPipes=7,
[Event Audit]
AuditLogonEvents = 3
[Version]
signature=""$CHICAGO$""
Revision=1
";

    [Fact]
    public void Parses_all_sections()
    {
        var inf = SecEditInf.Parse(Sample);
        Assert.Equal("14", inf.SystemAccess["MinimumPasswordLength"]);
        Assert.Equal("SecAdmin", inf.SystemAccess["NewAdministratorName"]);
        Assert.Equal(new[] { "*S-1-5-32-544", "*S-1-5-11" }, inf.PrivilegeRights["SeNetworkLogonRight"]);
        Assert.Empty(inf.PrivilegeRights["SeTcbPrivilege"]);
        Assert.Equal(3, inf.EventAudit["AuditLogonEvents"]);
        var lm = inf.RegistryValues[@"MACHINE\System\CurrentControlSet\Control\Lsa\LmCompatibilityLevel"];
        Assert.Equal(4, lm.Type);
        Assert.Equal(5, SecEditInf.DecodeRegistryValue(lm.Type, lm.Raw));
        var sddl = inf.RegistryValues[@"MACHINE\System\CurrentControlSet\Control\Lsa\RestrictRemoteSAM"];
        Assert.Equal("O:BAG:BAD:(A;;RC;;;BA)", SecEditInf.DecodeRegistryValue(sddl.Type, sddl.Raw));
    }

    [Fact]
    public void Decodes_utf16le_bom_buffer()
    {
        var buf = new byte[] { 0xff, 0xfe }.Concat(Encoding.Unicode.GetBytes(Sample)).ToArray();
        var inf = SecEditInf.ParseBuffer(buf);
        Assert.Equal("14", inf.SystemAccess["MinimumPasswordLength"]);
    }

    [Fact]
    public void Generates_inf_that_reparses_identically()
    {
        var builder = new SecEditInf.Builder();
        builder.SystemAccess["MinimumPasswordLength"] = "14";
        builder.SystemAccess["NewAdministratorName"] = "SecAdmin";
        builder.PrivilegeRights["SeDebugPrivilege"] = new List<string> { "*S-1-5-32-544" };
        builder.RegistryValues[@"MACHINE\Software\X\Lm"] = (4, "5");
        builder.RegistryValues[@"MACHINE\Software\X\Str"] = (1, "hello");
        builder.EventAudit["AuditSystemEvents"] = 3;

        var buf = builder.RenderBuffer();
        Assert.Equal(0xff, buf[0]);
        Assert.Equal(0xfe, buf[1]);

        var back = SecEditInf.ParseBuffer(buf);
        Assert.Equal("14", back.SystemAccess["MinimumPasswordLength"]);
        Assert.Equal("SecAdmin", back.SystemAccess["NewAdministratorName"]);
        Assert.Equal(new[] { "*S-1-5-32-544" }, back.PrivilegeRights["SeDebugPrivilege"]);
        Assert.Equal(5, SecEditInf.DecodeRegistryValue(back.RegistryValues[@"MACHINE\Software\X\Lm"].Type, back.RegistryValues[@"MACHINE\Software\X\Lm"].Raw));
        Assert.Equal("hello", SecEditInf.DecodeRegistryValue(back.RegistryValues[@"MACHINE\Software\X\Str"].Type, back.RegistryValues[@"MACHINE\Software\X\Str"].Raw));
        Assert.Equal(3, back.EventAudit["AuditSystemEvents"]);
    }

    [Fact]
    public void Numeric_system_access_values_are_unquoted()
    {
        var builder = new SecEditInf.Builder();
        builder.SystemAccess["MinimumPasswordLength"] = "14";
        builder.SystemAccess["NewGuestName"] = "Visitor";
        var text = builder.RenderText();
        Assert.Contains("MinimumPasswordLength = 14", text);       // bare
        Assert.Contains("NewGuestName = \"Visitor\"", text);        // quoted
    }
}

public class AuditCsvTests
{
    private const string Sample = @"Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value
WIN-SRV01,System,Security State Change,{0CCE9210-69AE-11D9-BED3-505054503030},Success,,1
WIN-SRV01,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,,3
WIN-SRV01,System,Account Lockout,{0cce9217-69ae-11d9-bed3-505054503030},Failure,,2
WIN-SRV01,System,Credential Validation,{0CCE923F-69AE-11D9-BED3-505054503030},No Auditing,,0
";

    [Fact]
    public void Parses_report_format()
    {
        var rows = AuditCsv.Parse(Sample);
        Assert.Equal(4, rows.Count);
        Assert.Equal(1, rows[0].Value);
        Assert.Equal(3, rows[1].Value);
        Assert.Equal(2, rows[2].Value);
        Assert.Equal(0, rows[3].Value);
        Assert.Equal("{0CCE9217-69AE-11D9-BED3-505054503030}", rows[2].Guid); // uppercased
    }

    [Fact]
    public void Derives_value_from_text_when_numeric_column_missing()
    {
        var noNumeric = "Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting\n" +
                        "HOST,System,Logon,{0CCE9215-69AE-11D9-BED3-505054503030},Success and Failure,\n";
        var rows = AuditCsv.Parse(noNumeric);
        Assert.Equal(3, rows[0].Value);
    }

    [Fact]
    public void Handles_quoted_commas()
    {
        var quoted = "HOST,System,\"Ticket Ops, extended\",{0CCE9240-69AE-11D9-BED3-505054503030},Success,,1";
        var rows = AuditCsv.Parse(quoted);
        Assert.Single(rows);
        Assert.Equal("Ticket Ops, extended", rows[0].Subcategory);
    }

    [Fact]
    public void Skips_non_guid_rows()
    {
        var messy = "\n\nMachine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value\nnot,a,real,row,at,all,0\n" + Sample;
        Assert.Equal(4, AuditCsv.Parse(messy).Count);
    }

    [Theory]
    [InlineData(0, "No Auditing")]
    [InlineData(1, "Success")]
    [InlineData(2, "Failure")]
    [InlineData(3, "Success and Failure")]
    public void Value_text_roundtrips(int value, string text)
    {
        Assert.Equal(text, AuditCsv.ValueToText(value));
        Assert.Equal(value, AuditCsv.ValueFromText(text));
    }
}
